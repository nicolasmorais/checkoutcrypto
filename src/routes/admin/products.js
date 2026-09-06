const express = require("express");
const { z } = require("zod");
const prisma = require("../../db");
const { logAudit } = require("../../lib/audit");
const { LOCALE_LABELS } = require("../../lib/emailTemplates");

const router = express.Router();

// Languages a product's checkout copy can be translated into. English lives
// on the base Product fields; these get rows in ProductTranslation.
const TRANSLATION_LOCALES = ["es", "fr", "de"];
const TRANSLATABLE_FIELDS = [
  "name",
  "description",
  "shortDescription",
  "checkoutTitle",
  "checkoutSubtitle",
  "checkoutButtonText",
  "successPageTitle",
  "successPageMessage",
];

function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const productSchema = z.object({
  name: z.string().min(1),
  price: z.coerce.number().min(0),
  cost: z.coerce.number().min(0).optional().or(z.literal("")),
  imageUrl: z.string().optional(),
});

function toCents(v) {
  if (v === "" || v === undefined || v === null) return undefined;
  return Math.round(Number(v) * 100);
}

// Pulls translation_<locale>_<field> fields out of the form body and saves
// one ProductTranslation row per locale that has at least one non-empty field.
async function saveTranslations(productId, body) {
  for (const locale of TRANSLATION_LOCALES) {
    const data = {};
    for (const field of TRANSLATABLE_FIELDS) {
      const value = body[`translation_${locale}_${field}`];
      data[field] = value ? value : null;
    }
    const hasContent = Object.values(data).some((v) => v);
    if (!hasContent) continue;

    await prisma.productTranslation.upsert({
      where: { productId_locale: { productId, locale } },
      update: data,
      create: { productId, locale, ...data },
    });
  }
}

// ── List ─────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: { variants: true },
  });
  res.render("admin/products/list", { products });
});

// ── New ──────────────────────────────────────────────────────────
router.get("/new", (req, res) => {
  res.render("admin/products/form", { product: null, errors: null, translationLocales: TRANSLATION_LOCALES });
});

router.post("/new", async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.render("admin/products/form", {
      product: req.body,
      errors: parsed.error.issues.map((i) => i.message),
      translationLocales: TRANSLATION_LOCALES,
      translationLabels: LOCALE_LABELS,
    });
  }
  const d = parsed.data;

  const product = await prisma.product.create({
    data: {
      name: d.name,
      slug: slugify(d.name),
      sku: `SKU-${Date.now()}`,
      imageUrl: d.imageUrl || null,
      price: toCents(d.price),
      cost: toCents(d.cost),
    },
  });

  await saveTranslations(product.id, req.body);

  await logAudit({
    adminUserId: req.adminUser.id,
    action: "product.created",
    entity: "Product",
    entityId: product.id,
    metadata: { name: product.name },
  });

  res.redirect(`/admin/products/${product.id}`);
});

// ── Edit ─────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: {
      variants: { orderBy: { sortOrder: "asc" } },
      prices: { orderBy: { currency: "asc" } },
      translations: true,
    },
  });
  if (!product) return res.status(404).render("admin/not-found", { entity: "Product" });

  const translationsByLocale = {};
  for (const t of product.translations) translationsByLocale[t.locale] = t;

  res.render("admin/products/form", {
    product,
    errors: null,
    translationLocales: TRANSLATION_LOCALES,
      translationLabels: LOCALE_LABELS,
    translationsByLocale,
  });
});

router.post("/:id", async (req, res) => {
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).render("admin/not-found", { entity: "Product" });

  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.render("admin/products/form", {
      product: { ...existing, prices: [], ...req.body },
      errors: parsed.error.issues.map((i) => i.message),
      translationLocales: TRANSLATION_LOCALES,
      translationLabels: LOCALE_LABELS,
    });
  }
  const d = parsed.data;

  const product = await prisma.product.update({
    where: { id: existing.id },
    data: {
      name: d.name,
      imageUrl: d.imageUrl || null,
      price: toCents(d.price),
      cost: toCents(d.cost),
    },
  });

  await saveTranslations(product.id, req.body);

  await logAudit({
    adminUserId: req.adminUser.id,
    action: "product.updated",
    entity: "Product",
    entityId: product.id,
    metadata: { name: product.name },
  });

  res.redirect(`/admin/products/${product.id}`);
});

router.post("/:id/delete", async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) return res.status(404).render("admin/not-found", { entity: "Product" });

  await prisma.product.delete({ where: { id: product.id } });

  await logAudit({
    adminUserId: req.adminUser.id,
    action: "product.deleted",
    entity: "Product",
    entityId: product.id,
    metadata: { name: product.name },
  });

  res.redirect("/admin/products");
});

// ── Fixed prices per currency ────────────────────────────────────
const priceSchema = z.object({
  currency: z.string().trim().min(3).max(3),
  price: z.coerce.number().min(0),
  compareAtPrice: z.coerce.number().min(0).optional().or(z.literal("")),
});

router.post("/:id/prices", async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) return res.status(404).render("admin/not-found", { entity: "Product" });

  const parsed = priceSchema.safeParse(req.body);
  if (!parsed.success) return res.redirect(`/admin/products/${product.id}`);
  const d = parsed.data;
  const currency = d.currency.toUpperCase();

  await prisma.productPrice.upsert({
    where: { productId_currency: { productId: product.id, currency } },
    update: { price: toCents(d.price), compareAtPrice: toCents(d.compareAtPrice) },
    create: { productId: product.id, currency, price: toCents(d.price), compareAtPrice: toCents(d.compareAtPrice) },
  });

  await logAudit({
    adminUserId: req.adminUser.id,
    action: "product.price_set",
    entity: "Product",
    entityId: product.id,
    metadata: { currency },
  });

  res.redirect(`/admin/products/${product.id}`);
});

router.post("/:id/prices/:priceId/delete", async (req, res) => {
  const price = await prisma.productPrice.findUnique({ where: { id: req.params.priceId } });
  if (!price || price.productId !== req.params.id) {
    return res.status(404).render("admin/not-found", { entity: "Product price" });
  }

  await prisma.productPrice.delete({ where: { id: price.id } });

  await logAudit({
    adminUserId: req.adminUser.id,
    action: "product.price_deleted",
    entity: "Product",
    entityId: req.params.id,
    metadata: { currency: price.currency },
  });

  res.redirect(`/admin/products/${req.params.id}`);
});

// ── Variants ─────────────────────────────────────────────────────
const variantSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  quantity: z.coerce.number().int().min(1),
  price: z.coerce.number().min(0),
  compareAtPrice: z.coerce.number().min(0).optional().or(z.literal("")),
  imageUrl: z.string().optional(),
  active: z.coerce.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

router.post("/:id/variants", async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) return res.status(404).render("admin/not-found", { entity: "Product" });

  const parsed = variantSchema.safeParse(req.body);
  if (!parsed.success) return res.redirect(`/admin/products/${product.id}`);
  const d = parsed.data;

  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      name: d.name,
      sku: d.sku,
      quantity: d.quantity,
      price: toCents(d.price),
      compareAtPrice: toCents(d.compareAtPrice),
      imageUrl: d.imageUrl || null,
      active: d.active ?? true,
      sortOrder: d.sortOrder ?? 0,
    },
  });

  await logAudit({
    adminUserId: req.adminUser.id,
    action: "variant.created",
    entity: "ProductVariant",
    entityId: variant.id,
    metadata: { productId: product.id, name: variant.name },
  });

  res.redirect(`/admin/products/${product.id}`);
});

router.post("/:id/variants/:variantId/delete", async (req, res) => {
  const variant = await prisma.productVariant.findUnique({ where: { id: req.params.variantId } });
  if (!variant || variant.productId !== req.params.id) {
    return res.status(404).render("admin/not-found", { entity: "ProductVariant" });
  }

  await prisma.productVariant.delete({ where: { id: variant.id } });

  await logAudit({
    adminUserId: req.adminUser.id,
    action: "variant.deleted",
    entity: "ProductVariant",
    entityId: variant.id,
    metadata: { productId: req.params.id },
  });

  res.redirect(`/admin/products/${req.params.id}`);
});

module.exports = router;
