// ── State ───────────────────────────────────────────────────────────
const PRODUCT_SLUG = "dermavit-c";
const PREFERRED_VARIANT_NAME = "3-Bottle Kit";

let product = null;
let variant = null;
let customerData = {};
let checkoutReference = null;

const $ = (s) => document.querySelector(s);

function formatMoney(cents, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
}

function showPage(id) {
  ["step1", "step2", "processingPage"].forEach((p) => $(`#${p}`).classList.add("hidden"));
  $(`#${id}`).classList.remove("hidden");
  window.scrollTo(0, 0);
}

// ── Load product from the backend (price/title always server-driven) ─
async function loadProduct() {
  const res = await fetch(`/api/products/${PRODUCT_SLUG}`);
  if (!res.ok) throw new Error("Product not available");
  product = await res.json();
  variant = product.variants.find((v) => v.name === PREFERRED_VARIANT_NAME) || product.variants[0] || null;

  const displayName = variant ? `${product.name} — ${variant.name}` : product.name;
  const meta = [
    variant ? `Qty: ${variant.quantity} bottle${variant.quantity === 1 ? "" : "s"}` : null,
    product.freeShipping ? "Free shipping" : product.shippingLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const price = variant ? variant.price : product.price;

  $("#s1-product-name").textContent = displayName;
  $("#s1-product-meta").textContent = meta;
  $("#s1-product-price").textContent = formatMoney(price, product.currency);

  $("#productName").textContent = displayName;
  $("#productMeta").textContent = meta;
  $("#productPrice").textContent = formatMoney(price, product.currency);
  $("#payBtnText").textContent = `${product.checkoutButtonText || "Continue to Secure Payment"} — ${formatMoney(price, product.currency)}`;
}

loadProduct().catch((err) => {
  $("#s1-product-name").textContent = "Unable to load product";
  console.error(err);
});

// ── Step 1 → Step 2 ───────────────────────────────────────────────
function clearErr(fieldId, errId) {
  $(`#${fieldId}`)?.classList.remove("err");
  $(`#${errId}`)?.classList.remove("show");
  $("#global-err").classList.add("hidden");
}
function fail(fieldId, errId) {
  $(`#${fieldId}`).classList.add("err");
  $(`#${errId}`).classList.add("show");
}

function goToPayment() {
  let ok = true;
  ["name", "email", "phone", "address", "city", "zip"].forEach((f) => clearErr(`cust-${f}`, `e-${f}`));

  if (!$("#cust-name").value.trim()) { fail("cust-name", "e-name"); ok = false; }
  if (!$("#cust-email").value.trim() || !$("#cust-email").value.includes("@")) { fail("cust-email", "e-email"); ok = false; }
  if (!$("#cust-phone").value.trim()) { fail("cust-phone", "e-phone"); ok = false; }
  if (!$("#cust-address").value.trim()) { fail("cust-address", "e-address"); ok = false; }
  if (!$("#cust-city").value.trim()) { fail("cust-city", "e-city"); ok = false; }
  if (!$("#cust-zip").value.trim()) { fail("cust-zip", "e-zip"); ok = false; }

  if (!ok) {
    $("#global-err").classList.remove("hidden");
    $("#global-err").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  customerData = {
    name: $("#cust-name").value.trim(),
    email: $("#cust-email").value.trim(),
    phone: $("#cust-phone").value.trim(),
    address: $("#cust-address").value.trim(),
    address2: $("#cust-address2").value.trim(),
    city: $("#cust-city").value.trim(),
    state: $("#cust-state").value,
    zip: $("#cust-zip").value.trim(),
    country: "US",
  };

  showPage("step2");
}

// ── Payment flow ────────────────────────────────────────────────────
async function startPayment() {
  const btn = $("#payBtn");
  const btnText = $("#payBtnText");
  const errorCard = $("#errorCard");

  btn.disabled = true;
  errorCard.classList.add("hidden");
  const originalLabel = btnText.textContent;
  btnText.innerHTML = '<div class="spinner"></div> Preparing secure payment...';

  try {
    // 1. Create the payment intent (price resolved server-side from the DB)
    const createRes = await fetch("/api/create-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productSlug: PRODUCT_SLUG,
        variantId: variant?.id,
        customer: customerData,
      }),
    });
    const created = await createRes.json();
    if (!createRes.ok) throw new Error(created.error || "Failed to create payment");
    checkoutReference = created.reference;

    // 2. Fetch available card payment methods for the customer's country
    const methodsRes = await fetch(
      `/api/checkout/${checkoutReference}/onramp/payment_methods?country=${encodeURIComponent(customerData.country)}&region=${encodeURIComponent(customerData.state || "")}`
    );
    const methods = await methodsRes.json();
    if (!methodsRes.ok) throw new Error(methods.error || "No card payment methods available");

    const methodList = methods.payment_methods || [];
    const creditCard = methodList.find((m) => m.code === "credit_card") || methodList.find((m) => m.code === "debit_card");
    if (!creditCard) throw new Error("No card payment method available for your region");

    const recommendedProvider = creditCard.providers?.find((p) => p.recommended) || creditCard.providers?.[0];
    renderProvider(recommendedProvider ? { name: creditCard.provider_name, icon_url: recommendedProvider.icon_url } : null);

    // 3. Create the funding session
    const sessionRes = await fetch(`/api/checkout/${checkoutReference}/onramp_sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment_method_id: creditCard.id,
        customer_email: customerData.email,
        country: customerData.country,
        region: customerData.state || undefined,
      }),
    });
    const session = await sessionRes.json();
    if (!sessionRes.ok) throw new Error(session.error || "Failed to start card payment");

    // 4. Redirect to the secure payment partner
    showPage("processingPage");
    if (session.url) {
      window.location.href = session.url;
    } else {
      throw new Error("Payment provider did not return a redirect URL");
    }
  } catch (err) {
    btn.disabled = false;
    btnText.textContent = originalLabel;
    errorCard.classList.remove("hidden");
    $("#errorText").textContent = err.message;
    console.error("Payment preparation error:", err);
  }
}

function resetPayment() {
  $("#errorCard").classList.add("hidden");
  $("#payBtn").disabled = false;
}

function renderProvider(provider) {
  const logo = $("#providerLogo");
  const text = $("#providerText");
  if (provider && (provider.name || provider.provider_name)) {
    const name = provider.name || provider.provider_name;
    text.textContent = "Secure payment powered by " + name;
    if (provider.icon_url) {
      logo.innerHTML = `<img src="${provider.icon_url}" alt="${name}">`;
    } else {
      logo.textContent = name.charAt(0);
    }
  } else {
    text.textContent = "Secure payment partner";
    logo.textContent = "—";
  }
}
