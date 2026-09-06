const express = require("express");
const prisma = require("../../db");
const { logAudit } = require("../../lib/audit");
const { sendRaw, sendTemplateTest } = require("../../lib/mailer");
const { setEnvVar } = require("../../lib/envFile");
const southpayWebhooks = require("../../lib/southpayWebhooks");
const { SouthPayError } = require("../../lib/southpay");
const {
  ensureDefaultTemplates,
  DEFAULT_TEMPLATES,
  TEMPLATE_VARS,
  TEMPLATE_LABELS,
  LOCALE_LABELS,
} = require("../../lib/emailTemplates");

const router = express.Router();

const TEST_EMAIL_TO = "contaadm154@gmail.com";

async function getSettings() {
  return prisma.storeSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
}

router.get("/", (req, res) => res.redirect("/admin/settings/checkout"));

router.get("/checkout", async (req, res) => {
  const settings = await getSettings();
  res.render("admin/settings/checkout", { settings, saved: req.query.saved === "1" });
});

router.post("/checkout", async (req, res) => {
  const { storeName, storeLogo, supportEmail, supportPhone, defaultCurrency, checkoutSecureBadge, checkoutPrimaryColor, checkoutButtonText } = req.body;

  const settings = await prisma.storeSettings.upsert({
    where: { id: "default" },
    update: {
      storeName,
      storeLogo: storeLogo || null,
      supportEmail: supportEmail || null,
      supportPhone: supportPhone || null,
      defaultCurrency: (defaultCurrency || "USD").toUpperCase(),
      checkoutSecureBadge: checkoutSecureBadge === "on",
      checkoutPrimaryColor: checkoutPrimaryColor || "#7C6FEB",
      checkoutButtonText: checkoutButtonText || "Pay Now",
    },
    create: { id: "default", storeName },
  });

  await logAudit({
    adminUserId: req.adminUser.id,
    action: "settings.checkout_updated",
    entity: "StoreSettings",
    entityId: settings.id,
  });

  res.redirect("/admin/settings/checkout?saved=1");
});

function webhookUrlFor(req) {
  return `${req.protocol}://${req.get("host")}/api/webhooks/southpay`;
}

router.get("/payments", async (req, res) => {
  const settings = await getSettings();
  const webhookUrl = webhookUrlFor(req);

  let webhookEndpoints = [];
  let webhookListError = null;
  try {
    const data = await southpayWebhooks.listEndpoints();
    webhookEndpoints = data.data || data.webhook_endpoints || (Array.isArray(data) ? data : []);
  } catch (err) {
    webhookListError = err instanceof SouthPayError ? err.message : "Couldn't reach SouthPay.";
  }

  const matchingEndpoint = webhookEndpoints.find((e) => e.url === webhookUrl) || null;

  res.render("admin/settings/payments", {
    settings,
    saved: req.query.saved === "1",
    webhookRegistered: req.query.webhookRegistered === "1",
    webhookError: req.query.webhookError || null,
    env: {
      apiUrl: process.env.SOUTHPAY_API_URL || "",
      hasSecretKey: Boolean(process.env.SOUTHPAY_SECRET_KEY),
      hasWebhookSecret: Boolean(process.env.SOUTHPAY_WEBHOOK_SECRET),
    },
    webhookUrl,
    webhookEndpoints,
    webhookListError,
    matchingEndpoint,
  });
});

router.get("/email", async (req, res) => {
  await ensureDefaultTemplates();
  const settings = await getSettings();
  const templates = await prisma.emailTemplate.findMany({ orderBy: [{ key: "asc" }, { locale: "asc" }] });
  res.render("admin/settings/email", {
    settings,
    templates,
    templateLabels: TEMPLATE_LABELS,
    localeLabels: LOCALE_LABELS,
    saved: req.query.saved === "1",
    testSent: req.query.testSent === "1",
    testTo: req.query.testTo || TEST_EMAIL_TO,
    testError: req.query.testError || null,
    env: {
      hasApiKey: Boolean(process.env.RESEND_API_KEY),
      fromEmail: process.env.RESEND_FROM_EMAIL || "",
    },
  });
});

router.post("/email", async (req, res) => {
  const { emailEnabled } = req.body;

  const settings = await prisma.storeSettings.upsert({
    where: { id: "default" },
    update: { emailEnabled: emailEnabled === "on" },
    create: { id: "default" },
  });

  await logAudit({
    adminUserId: req.adminUser.id,
    action: "settings.email_updated",
    entity: "StoreSettings",
    entityId: settings.id,
  });

  res.redirect("/admin/settings/email?saved=1");
});

router.post("/email/test", async (req, res) => {
  const to = ((req.body && req.body.to) || TEST_EMAIL_TO).trim();
  try {
    await sendRaw({
      to,
      subject: "Test email from your store",
      html: `<p>This is a test email — your Resend connection is working.</p>`,
    });
    res.redirect(`/admin/settings/email?testSent=1&testTo=${encodeURIComponent(to)}`);
  } catch (err) {
    res.redirect(`/admin/settings/email?testError=${encodeURIComponent(err.message || "Failed to send")}`);
  }
});

router.get("/email-templates/:id", async (req, res) => {
  const template = await prisma.emailTemplate.findUnique({ where: { id: req.params.id } });
  if (!template) return res.status(404).render("admin/not-found", { entity: "Email template" });

  res.render("admin/settings/email-template", {
    template,
    label: TEMPLATE_LABELS[template.key] || template.key,
    localeLabel: LOCALE_LABELS[template.locale] || template.locale,
    vars: TEMPLATE_VARS[template.key] || [],
    saved: req.query.saved === "1",
    testSent: req.query.testSent === "1",
    testTo: req.query.testTo || TEST_EMAIL_TO,
    testError: req.query.testError || null,
  });
});

router.post("/email-templates/:id", async (req, res) => {
  const existing = await prisma.emailTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).render("admin/not-found", { entity: "Email template" });

  const { subject, bodyHtml } = req.body;
  await prisma.emailTemplate.update({
    where: { id: existing.id },
    data: { subject: subject || existing.subject, bodyHtml: bodyHtml ?? existing.bodyHtml },
  });

  await logAudit({
    adminUserId: req.adminUser.id,
    action: "settings.email_template_updated",
    entity: "EmailTemplate",
    entityId: existing.id,
    metadata: { key: existing.key, locale: existing.locale },
  });

  res.redirect(`/admin/settings/email-templates/${existing.id}?saved=1`);
});

router.post("/email-templates/:id/test", async (req, res) => {
  const template = await prisma.emailTemplate.findUnique({ where: { id: req.params.id } });
  if (!template) return res.status(404).render("admin/not-found", { entity: "Email template" });

  const to = ((req.body && req.body.to) || TEST_EMAIL_TO).trim();
  try {
    await sendTemplateTest({ key: template.key, locale: template.locale, to });
    res.redirect(`/admin/settings/email-templates/${template.id}?testSent=1&testTo=${encodeURIComponent(to)}`);
  } catch (err) {
    res.redirect(`/admin/settings/email-templates/${template.id}?testError=${encodeURIComponent(err.message || "Failed to send")}`);
  }
});

router.post("/email-templates/:id/reset", async (req, res) => {
  const existing = await prisma.emailTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).render("admin/not-found", { entity: "Email template" });

  const def = DEFAULT_TEMPLATES[existing.key]?.[existing.locale];
  if (def) {
    await prisma.emailTemplate.update({
      where: { id: existing.id },
      data: { subject: def.subject, bodyHtml: def.bodyHtml },
    });
  }

  res.redirect(`/admin/settings/email-templates/${existing.id}?saved=1`);
});

router.post("/payments/webhook/register", async (req, res) => {
  const webhookUrl = webhookUrlFor(req);
  try {
    const data = await southpayWebhooks.listEndpoints();
    const endpoints = data.data || data.webhook_endpoints || (Array.isArray(data) ? data : []);
    const existing = endpoints.find((e) => e.url === webhookUrl);

    if (existing) {
      // Already registered — just make sure it's subscribed to the events we consume.
      await southpayWebhooks.updateEndpointEvents(existing.id, webhookUrl);
    } else {
      const created = await southpayWebhooks.createEndpoint(webhookUrl);
      if (created.signing_secret) {
        setEnvVar("SOUTHPAY_WEBHOOK_SECRET", created.signing_secret);
      }
    }

    await logAudit({
      adminUserId: req.adminUser.id,
      action: "settings.webhook_registered",
      entity: "StoreSettings",
      entityId: "default",
      metadata: { url: webhookUrl },
    });

    res.redirect("/admin/settings/payments?webhookRegistered=1");
  } catch (err) {
    const message = err instanceof SouthPayError ? err.message : "Couldn't reach SouthPay.";
    res.redirect(`/admin/settings/payments?webhookError=${encodeURIComponent(message)}`);
  }
});

router.post("/payments/webhook/rotate", async (req, res) => {
  const { endpointId } = req.body;
  if (!endpointId) return res.redirect("/admin/settings/payments");

  try {
    const rotated = await southpayWebhooks.rotateSecret(endpointId);
    if (rotated.signing_secret) {
      setEnvVar("SOUTHPAY_WEBHOOK_SECRET", rotated.signing_secret);
    }

    await logAudit({
      adminUserId: req.adminUser.id,
      action: "settings.webhook_secret_rotated",
      entity: "StoreSettings",
      entityId: "default",
      metadata: { endpointId },
    });

    res.redirect("/admin/settings/payments?webhookRegistered=1");
  } catch (err) {
    const message = err instanceof SouthPayError ? err.message : "Couldn't reach SouthPay.";
    res.redirect(`/admin/settings/payments?webhookError=${encodeURIComponent(message)}`);
  }
});

router.post("/payments", async (req, res) => {
  const { southpayEnabled, southpayEnvironment, paymentProvider } = req.body;

  const settings = await prisma.storeSettings.upsert({
    where: { id: "default" },
    update: {
      southpayEnabled: southpayEnabled === "on",
      southpayEnvironment: southpayEnvironment || "live",
      paymentProvider: paymentProvider || "southpay",
    },
    create: { id: "default" },
  });

  await logAudit({
    adminUserId: req.adminUser.id,
    action: "settings.payments_updated",
    entity: "StoreSettings",
    entityId: settings.id,
  });

  res.redirect("/admin/settings/payments?saved=1");
});

module.exports = router;
