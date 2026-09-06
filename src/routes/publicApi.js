const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { southpayFetch, authHeaders, SouthPayError } = require("../lib/southpay");
const { generateOrderNumber } = require("../lib/orderNumber");
const { syncOrderFromProviderStatus } = require("../lib/orderSync");

const router = express.Router();

const SUPPORTED_LOCALES = ["en", "es", "fr", "de"];

function resolveLocale(input) {
  return SUPPORTED_LOCALES.includes(input) ? input : "en";
}

// Fixed price for the requested currency (ProductPrice), falling back to the
// product's base price/currency — never exchange-rate converted.
async function resolvePrice(product, currency) {
  if (!currency || currency.toUpperCase() === product.currency) {
    return { price: product.price, compareAtPrice: product.compareAtPrice, currency: product.currency };
  }
  const override = await prisma.productPrice.findUnique({
    where: { productId_currency: { productId: product.id, currency: currency.toUpperCase() } },
  });
  if (!override) return { price: product.price, compareAtPrice: product.compareAtPrice, currency: product.currency };
  return { price: override.price, compareAtPrice: override.compareAtPrice, currency: override.currency };
}

// Translated checkout copy for the requested locale, falling back to the
// product's base (English) fields for any field without an override.
async function resolveTranslation(product, locale) {
  const base = {
    name: product.name,
    description: product.description,
    shortDescription: product.shortDescription,
    checkoutTitle: product.checkoutTitle,
    checkoutSubtitle: product.checkoutSubtitle,
    checkoutButtonText: product.checkoutButtonText,
    successPageTitle: product.successPageTitle,
    successPageMessage: product.successPageMessage,
  };
  if (locale === "en") return base;

  const translation = await prisma.productTranslation.findUnique({
    where: { productId_locale: { productId: product.id, locale } },
  });
  if (!translation) return base;

  const merged = { ...base };
  for (const field of Object.keys(base)) {
    if (translation[field]) merged[field] = translation[field];
  }
  return merged;
}

const createPaymentSchema = z.object({
  productSlug: z.string().min(1),
  variantId: z.string().optional(),
  currency: z.string().optional(),
  locale: z.string().optional(),
  customer: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
    address: z.string().min(1),
    address2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().optional(),
    zip: z.string().min(1),
    country: z.string().min(2),
  }),
});

// ── Public product info (safe subset — used to render the checkout) ─
router.get("/products/:slug", async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { slug: req.params.slug },
    include: { variants: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!product || !product.active) return res.status(404).json({ error: "Product not available" });

  const locale = resolveLocale(req.query.locale);
  const [priceInfo, copy] = await Promise.all([
    resolvePrice(product, req.query.currency),
    resolveTranslation(product, locale),
  ]);

  res.json({
    name: copy.name,
    slug: product.slug,
    imageUrl: product.imageUrl,
    price: priceInfo.price,
    compareAtPrice: priceInfo.compareAtPrice,
    currency: priceInfo.currency,
    locale,
    freeShipping: product.freeShipping,
    shippingLabel: product.shippingLabel,
    description: copy.description,
    shortDescription: copy.shortDescription,
    checkoutTitle: copy.checkoutTitle,
    checkoutSubtitle: copy.checkoutSubtitle,
    checkoutImage: product.checkoutImage,
    checkoutButtonText: copy.checkoutButtonText,
    successPageTitle: copy.successPageTitle,
    successPageMessage: copy.successPageMessage,
    variants: product.variants.map((v) => ({
      id: v.id,
      name: v.name,
      quantity: v.quantity,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      imageUrl: v.imageUrl,
    })),
  });
});

// ── Create Payment Intent ───────────────────────────────────────────
// Price is ALWAYS resolved server-side from the DB. Client-supplied
// amount/price fields are never trusted.
router.post("/create-payment", async (req, res) => {
  try {
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    }
    const { productSlug, variantId, currency: requestedCurrency, locale: requestedLocale, customer } = parsed.data;

    const product = await prisma.product.findUnique({ where: { slug: productSlug } });
    if (!product || !product.active) {
      return res.status(404).json({ error: "Product not available" });
    }

    let variant = null;
    if (variantId) {
      variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
      if (!variant || variant.productId !== product.id || !variant.active) {
        return res.status(404).json({ error: "Variant not available" });
      }
    }

    const locale = resolveLocale(requestedLocale);
    // Variants don't have per-currency fixed prices — only the base product does.
    const { price: unitPrice, currency } = variant
      ? { price: variant.price, currency: product.currency }
      : await resolvePrice(product, requestedCurrency);
    const translatedName = (await resolveTranslation(product, locale)).name;
    const itemName = variant ? `${translatedName} — ${variant.name}` : translatedName;
    const itemSku = variant ? variant.sku : product.sku;

    // find-or-create customer by email
    let dbCustomer = await prisma.customer.findUnique({ where: { email: customer.email } });
    if (!dbCustomer) {
      dbCustomer = await prisma.customer.create({
        data: { fullName: customer.name, email: customer.email, phone: customer.phone },
      });
    }

    const address = await prisma.address.create({
      data: {
        customerId: dbCustomer.id,
        fullName: customer.name,
        street: customer.address,
        street2: customer.address2 || null,
        city: customer.city,
        state: customer.state || null,
        zipCode: customer.zip,
        country: customer.country,
        phone: customer.phone,
      },
    });

    const orderNumber = generateOrderNumber();
    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerId: dbCustomer.id,
        status: "pending_payment",
        paymentStatus: "pending",
        currency,
        locale,
        subtotal: unitPrice,
        shipping: 0,
        discount: 0,
        total: unitPrice,
        email: customer.email,
        phone: customer.phone,
        shippingAddressId: address.id,
        items: {
          create: [
            {
              productId: product.id,
              variantId: variant?.id,
              name: itemName,
              sku: itemSku,
              quantity: 1,
              unitPrice,
              total: unitPrice,
            },
          ],
        },
      },
    });

    await prisma.checkoutSession.create({
      data: {
        orderId: order.id,
        productId: product.id,
        variantId: variant?.id,
        customerId: dbCustomer.id,
        step: "payment",
        status: "in_progress",
        customerDataCompletedAt: new Date(),
        paymentPageViewedAt: new Date(),
      },
    });

    const idempotencyKey = `order-${order.id}`;

    const data = await southpayFetch("/payments", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        payment_intent: {
          amount: String(unitPrice / 100),
          currency,
          order_id: orderNumber,
          title: product.checkoutTitle || product.name,
          description: product.checkoutSubtitle || product.shortDescription || itemName,
          success_url: `${req.protocol}://${req.get("host")}/success.html`,
          failed_url: `${req.protocol}://${req.get("host")}/failed.html`,
          metadata: { orderId: order.id, orderNumber, email: customer.email },
          line_items: [
            {
              description: itemName,
              quantity: 1,
              unit_amount_cents: unitPrice,
            },
          ],
        },
      }),
    });

    await prisma.order.update({
      where: { id: order.id },
      data: {
        southpayReference: data.reference,
        southpayPaymentIntentId: data.id || data.payment_intent_id || null,
      },
    });

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "southpay",
        providerPaymentId: data.id || null,
        providerReference: data.reference,
        amount: unitPrice,
        currency,
        status: "pending",
      },
    });

    await prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        provider: "southpay",
        sessionId: data.reference,
        status: "pending",
        amount: unitPrice,
        currency,
      },
    });

    res.json(data);
  } catch (err) {
    if (err instanceof SouthPayError) return res.status(err.status).json({ error: err.message });
    console.error("Create payment error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get Checkout Info (public, no auth needed) ──────────────────────
router.get("/checkout/:reference", async (req, res) => {
  try {
    const data = await southpayFetch(`/checkout/${req.params.reference}`);

    syncOrderFromProviderStatus({
      reference: req.params.reference,
      providerStatus: data.status,
      providerTxid: data.transactions?.[0]?.txid || data.transactions?.[0]?.hash || null,
      providerName: data.transactions?.[0]?.asset?.coin_symbol || null,
      source: "poll",
    }).catch((err) => console.error("order sync (poll) failed:", err));

    res.json(data);
  } catch (err) {
    if (err instanceof SouthPayError) return res.status(err.status).json({ error: err.message });
    console.error("Checkout fetch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get Card Payment Methods (onramp) ───────────────────────────────
router.get("/checkout/:reference/onramp/payment_methods", async (req, res) => {
  try {
    const { country, region } = req.query;
    let path = `/checkout/${req.params.reference}/onramp/payment_methods`;
    const params = new URLSearchParams();
    if (country) params.set("country", country);
    if (region) params.set("region", region);
    if (params.toString()) path += `?${params}`;

    const data = await southpayFetch(path);
    res.json(data);
  } catch (err) {
    if (err instanceof SouthPayError) return res.status(err.status).json({ error: err.message });
    console.error("Onramp methods error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Create Onramp (card) Session ────────────────────────────────────
router.post("/checkout/:reference/onramp_sessions", async (req, res) => {
  try {
    const data = await southpayFetch(`/checkout/${req.params.reference}/onramp_sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    await prisma.order
      .updateMany({
        where: { southpayReference: req.params.reference },
        data: {
          southpayOnrampSessionId: data.id || data.session_id || null,
          southpayOnrampStatus: data.status || null,
        },
      })
      .catch((err) => console.error("order onramp update failed:", err));

    res.json(data);
  } catch (err) {
    if (err instanceof SouthPayError) return res.status(err.status).json({ error: err.message });
    console.error("Onramp session error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get Payment Intent (authenticated, SouthPay API key) ───────────
router.get("/payments/:id", async (req, res) => {
  try {
    const data = await southpayFetch(`/payments/${req.params.id}`, { headers: authHeaders() });
    res.json(data);
  } catch (err) {
    if (err instanceof SouthPayError) return res.status(err.status).json({ error: err.message });
    console.error("Payment fetch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
