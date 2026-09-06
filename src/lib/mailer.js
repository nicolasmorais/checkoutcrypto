const prisma = require("../db");
const { getTemplate, renderTemplate } = require("./emailTemplates");

let resendClient = null;
function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendClient) {
    const { Resend } = require("resend");
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

async function sendRaw({ to, subject, html }) {
  const resend = getResend();
  if (!resend) throw new Error("RESEND_API_KEY is not set");

  const from = process.env.RESEND_FROM_EMAIL || "Store <no-reply@example.com>";
  const { data, error } = await resend.emails.send({ from, to, subject, html });
  if (error) {
    console.error(`[mailer] Resend error sending "${subject}" to ${to}:`, error);
    throw new Error(error.message || "Failed to send email");
  }
  return data;
}

async function sendMail({ to, subject, html }) {
  const settings = await prisma.storeSettings.findUnique({ where: { id: "default" } });
  if (!settings?.emailEnabled) {
    console.log(`[mailer] email disabled, skipping "${subject}" to ${to}`);
    return { skipped: true };
  }
  if (!process.env.RESEND_API_KEY) {
    console.log(`[mailer] RESEND_API_KEY not set, logging only: "${subject}" to ${to}`);
    return { skipped: true };
  }
  return sendRaw({ to, subject, html });
}

function formatMoney(cents, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(
    (cents || 0) / 100
  );
}

async function getBrand() {
  const settings = await prisma.storeSettings.findUnique({ where: { id: "default" } });
  return {
    storeName: settings?.storeName || "Store",
    logo: settings?.storeLogo || null,
    accent: settings?.checkoutPrimaryColor || "#7C6FEB",
    supportEmail: settings?.supportEmail || null,
  };
}

// Shared email shell — a simple, table-based layout that renders consistently
// across email clients (no flexbox/grid, inline styles only). The template
// body (edited in the admin) is dropped into the middle, already rendered.
function emailShell({ brand, preheader, bodyHtml }) {
  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0; padding:0; background:#F2F2F5; font-family:'DM Sans', Helvetica, Arial, sans-serif;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader || ""}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F5; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px; max-width:100%; background:#FFFFFF; border-radius:16px; overflow:hidden; border:1px solid #E3E3EA;">
            <tr>
              <td style="padding:28px 32px; border-bottom:1px solid #E3E3EA;">
                ${
                  brand.logo
                    ? `<img src="${brand.logo}" alt="${brand.storeName}" height="28" style="display:block;" />`
                    : `<span style="font-size:17px; font-weight:700; color:#0E0E14;">${brand.storeName}</span>`
                }
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; border-top:1px solid #E3E3EA; font-size:12px; color:#ABABBC;">
                ${brand.storeName}${brand.supportEmail ? ` · Questions? <a href="mailto:${brand.supportEmail}" style="color:${brand.accent};">${brand.supportEmail}</a>` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Item rows only — the confirmation email's own design shows the total in a
// separate, more prominent block (via the {{total}} variable), so this must
// not repeat it.
function itemsTable(items, currency) {
  const rows = items
    .map(
      (it) => `
        <tr>
          <td style="padding:10px 0; border-bottom:1px solid #EFEFED; font-size:13.5px; color:#111;">${it.quantity}× ${it.name}</td>
          <td style="padding:10px 0; border-bottom:1px solid #EFEFED; font-size:13.5px; color:#888; text-align:right; white-space:nowrap;">${formatMoney(it.total, currency)}</td>
        </tr>`
    )
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

// A template body can be a fragment (dropped into the shared shell) or a
// full, self-contained HTML document (its own <head>/branding/footer) —
// admins can paste a fully custom design and it's sent as-is, unwrapped.
function isFullDocument(html) {
  return /^\s*(<!doctype\s+html|<html)/i.test(html || "");
}

// Renders a DB-stored template (subject + body) for the given key/locale,
// substituting {{variables}}, and wraps it in the branded shell unless the
// template is already a full HTML document. Pure — does not send anything.
async function renderTemplateEmail({ key, locale, vars }) {
  const brand = await getBrand();
  const tpl = await getTemplate(key, locale);
  if (!tpl) throw new Error(`No email template found for "${key}"`);

  const allVars = { storeName: brand.storeName, supportEmail: brand.supportEmail || "", ...vars };
  const subject = renderTemplate(tpl.subject, allVars);
  const bodyHtml = renderTemplate(tpl.bodyHtml, allVars);
  const html = isFullDocument(bodyHtml) ? bodyHtml : emailShell({ brand, preheader: subject, bodyHtml });

  return { subject, html };
}

async function renderAndSend({ key, order, extraVars = {} }) {
  const vars = {
    customerName: order.customer?.fullName || order.email,
    orderNumber: order.orderNumber,
    total: formatMoney(order.total, order.currency),
    currency: order.currency,
    ...extraVars,
  };

  const { subject, html } = await renderTemplateEmail({ key, locale: order.locale || "en", vars });
  return sendMail({ to: order.email, subject, html });
}

async function sendOrderConfirmationEmail(order) {
  return renderAndSend({
    key: "order_confirmation",
    order,
    extraVars: { itemsHtml: itemsTable(order.items, order.currency) },
  });
}

async function sendPaymentFailedEmail(order) {
  return renderAndSend({ key: "payment_failed", order });
}

const TRACK_BUTTON_LABEL = {
  en: "Track your package",
  es: "Rastrear pedido",
  fr: "Suivre la commande",
  de: "Sendung verfolgen",
};

async function sendTrackingEmail(order) {
  const brand = await getBrand();
  const locale = order.locale || "en";
  const label = TRACK_BUTTON_LABEL[locale] || TRACK_BUTTON_LABEL.en;
  const trackingLinkHtml = order.trackingUrl
    ? `<a href="${order.trackingUrl}" style="display:block; text-align:center; background:#2D6A4F; color:#fff; font-size:14px; font-weight:600; text-decoration:none; padding:14px 24px; border-radius:6px; letter-spacing:0.3px;">${label}</a>`
    : "";

  return renderAndSend({
    key: "tracking",
    order,
    extraVars: {
      trackingCarrier: order.trackingCarrier || "—",
      trackingNumber: order.trackingNumber || "—",
      trackingUrl: order.trackingUrl || "",
      trackingLinkHtml,
    },
  });
}

// Realistic placeholder data for the "send test" button on each template's
// edit page — lets an admin see (and receive) exactly what a real send
// would look like, without needing a real order.
function sampleVars(key, locale) {
  const base = { customerName: "Ana Souza", orderNumber: "10482" };

  if (key === "order_confirmation") {
    return {
      ...base,
      total: formatMoney(3900, "USD"),
      currency: "USD",
      itemsHtml: itemsTable([{ quantity: 1, name: "Glow Serum", total: 3900 }], "USD"),
    };
  }
  if (key === "payment_failed") {
    return { ...base, total: formatMoney(3900, "USD"), currency: "USD" };
  }
  if (key === "tracking") {
    const trackingUrl = "https://example.com/track/BR123456789";
    const label = TRACK_BUTTON_LABEL[locale] || TRACK_BUTTON_LABEL.en;
    return {
      ...base,
      trackingCarrier: "DHL",
      trackingNumber: "BR123456789",
      trackingUrl,
      trackingLinkHtml: `<a href="${trackingUrl}" style="display:block; text-align:center; background:#2D6A4F; color:#fff; font-size:14px; font-weight:600; text-decoration:none; padding:14px 24px; border-radius:6px; letter-spacing:0.3px;">${label}</a>`,
    };
  }
  return base;
}

// Sends one template (subject + body, sample data) straight through Resend —
// bypasses the "send emails automatically" toggle, same as the connection
// test button, since this is an explicit admin action.
async function sendTemplateTest({ key, locale, to }) {
  const { subject, html } = await renderTemplateEmail({ key, locale, vars: sampleVars(key, locale) });
  await sendRaw({ to, subject: `[Test] ${subject}`, html });
}

module.exports = {
  sendMail,
  sendRaw,
  sendOrderConfirmationEmail,
  sendPaymentFailedEmail,
  sendTrackingEmail,
  sendTemplateTest,
};
