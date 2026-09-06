const prisma = require("../db");

// Variables available to each template, shown as hints in the admin editor.
const TEMPLATE_VARS = {
  order_confirmation: ["storeName", "supportEmail", "customerName", "orderNumber", "itemsHtml", "total", "currency"],
  payment_failed: ["storeName", "supportEmail", "customerName", "orderNumber", "total", "currency"],
  tracking: ["storeName", "supportEmail", "customerName", "orderNumber", "trackingCarrier", "trackingNumber", "trackingUrl", "trackingLinkHtml"],
};

const TEMPLATE_LABELS = {
  order_confirmation: "Payment confirmed",
  payment_failed: "Payment failed",
  tracking: "Shipping / tracking code",
};

const LOCALES = ["en", "es", "fr", "de"];
const LOCALE_LABELS = { en: "English", es: "Español", fr: "Français", de: "Deutsch" };

// {{var}} substitution only — no expressions, no eval. Unknown vars render as "".
function renderTemplate(str, vars) {
  return String(str || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) =>
    vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ""
  );
}

// Full, self-contained HTML document for the tracking email (own head/branding/
// footer — sent as-is, not wrapped in the shared shell). One shared builder,
// filled in per language below, so the four locales never drift out of sync.
function trackingDesign(t) {
  return `<!DOCTYPE html>
<html lang="${t.htmlLang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.title}</title>
</head>
<body style="margin:0;padding:0;background:#F2F2EF;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">

<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F2F2EF;">
  <tr>
    <td align="center" style="padding:48px 16px;">

      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;">

        <!-- Logo / Brand -->
        <tr>
          <td align="center" style="padding-bottom:28px;">
            <span style="font-size:13px;letter-spacing:2.5px;color:#888;text-transform:uppercase;font-weight:500;">{{storeName}}</span>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#FFFFFF;border-radius:6px;overflow:hidden;">

            <!-- Green top bar -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr><td style="height:3px;background:#2D6A4F;"></td></tr>
            </table>

            <!-- Body -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="padding:36px 40px 12px;">

                  <!-- Icon -->
                  <table role="presentation" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width:40px;height:40px;background:#EBF4EF;border-radius:50%;text-align:center;vertical-align:middle;">
                        <img src="https://api.iconify.design/lucide/package.svg?color=%232D6A4F&width=18&height=18" width="18" height="18" alt="" style="display:block;margin:11px auto 0;">
                      </td>
                    </tr>
                  </table>

                  <!-- Heading -->
                  <h1 style="margin:20px 0 6px;font-size:20px;font-weight:600;color:#111;letter-spacing:-0.2px;line-height:1.3;">
                    ${t.heading}
                  </h1>
                  <p style="margin:0 0 32px;font-size:14px;color:#888;line-height:1.6;">
                    ${t.sub}
                  </p>

                </td>
              </tr>

              <!-- Tracking rows -->
              <tr>
                <td style="padding:0 40px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">

                    <tr>
                      <td style="padding:14px 0;border-top:1px solid #EFEFED;">
                        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                          <tr>
                            <td style="font-size:12px;color:#AAA;letter-spacing:0.3px;">${t.carrierLabel}</td>
                            <td align="right" style="font-size:14px;font-weight:600;color:#111;">{{trackingCarrier}}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding:14px 0;border-top:1px solid #EFEFED;">
                        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                          <tr>
                            <td style="font-size:12px;color:#AAA;letter-spacing:0.3px;">${t.trackingLabel}</td>
                            <td align="right" style="font-size:13px;font-weight:600;color:#111;font-family:'Courier New',Courier,monospace;letter-spacing:0.5px;">{{trackingNumber}}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                  </table>
                </td>
              </tr>

              <!-- CTA -->
              <tr>
                <td style="padding:28px 40px 36px;">
                  {{trackingLinkHtml}}
                </td>
              </tr>

            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 0 0;" align="center">
            <p style="margin:0;font-size:11px;color:#BBB;line-height:1.7;text-align:center;">
              ${t.questions} — {{supportEmail}}<br>
              ${t.received}
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
}

// Same idea as trackingDesign — a full, self-contained document for the
// "payment confirmed" email, filled in per language below.
function confirmationDesign(t) {
  return `<!DOCTYPE html>
<html lang="${t.htmlLang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.title}</title>
</head>
<body style="margin:0;padding:0;background:#F2F2EF;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">

<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F2F2EF;">
  <tr>
    <td align="center" style="padding:48px 16px;">

      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;">

        <!-- Brand -->
        <tr>
          <td align="center" style="padding-bottom:28px;">
            <span style="font-size:13px;letter-spacing:2.5px;color:#888;text-transform:uppercase;font-weight:500;">{{storeName}}</span>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#FFFFFF;border-radius:6px;overflow:hidden;">

            <!-- Green accent bar -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr><td style="height:3px;background:#2D6A4F;"></td></tr>
            </table>

            <!-- Header -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="padding:36px 40px 28px;">

                  <!-- Check badge -->
                  <table role="presentation" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width:40px;height:40px;background:#EBF4EF;border-radius:50%;text-align:center;vertical-align:middle;">
                        <img src="https://api.iconify.design/lucide/check.svg?color=%232D6A4F&width=18&height=18" width="18" height="18" alt="" style="display:block;margin:11px auto 0;">
                      </td>
                    </tr>
                  </table>

                  <h1 style="margin:20px 0 6px;font-size:20px;font-weight:600;color:#111;letter-spacing:-0.2px;line-height:1.3;">
                    ${t.heading}
                  </h1>
                  <p style="margin:0;font-size:14px;color:#888;line-height:1.6;">
                    ${t.sub}
                  </p>

                </td>
              </tr>
            </table>

            <!-- Divider -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr><td style="height:1px;background:#EFEFED;"></td></tr>
            </table>

            <!-- Items -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="padding:20px 40px 0;">
                  <span style="font-size:11px;letter-spacing:0.5px;color:#AAA;text-transform:uppercase;">${t.itemsLabel}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 40px 0;">
                  {{itemsHtml}}
                </td>
              </tr>
            </table>

            <!-- Total -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="padding:16px 40px 28px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #EFEFED;padding-top:14px;">
                    <tr>
                      <td style="padding-top:14px;font-size:13px;color:#888;font-weight:500;">${t.totalLabel}</td>
                      <td style="padding-top:14px;" align="right">
                        <span style="font-size:17px;font-weight:700;color:#111;letter-spacing:-0.3px;">{{total}}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Divider -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr><td style="height:1px;background:#EFEFED;"></td></tr>
            </table>

            <!-- Next step -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="padding:24px 40px 32px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td style="width:3px;background:#2D6A4F;border-radius:2px;"></td>
                      <td style="padding-left:14px;">
                        <p style="margin:0;font-size:13px;color:#666;line-height:1.6;">
                          ${t.nextStep}
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 0 0;" align="center">
            <p style="margin:0;font-size:11px;color:#BBB;line-height:1.8;text-align:center;">
              ${t.questions}: <a href="mailto:{{supportEmail}}" style="color:#2D6A4F;text-decoration:none;">{{supportEmail}}</a><br>
              ${t.received}
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
}

const DEFAULT_TEMPLATES = {
  order_confirmation: {
    en: {
      subject: "Payment confirmed — Order #{{orderNumber}}",
      bodyHtml: confirmationDesign({
        htmlLang: "en",
        title: "Payment confirmed — {{storeName}}",
        heading: "Payment confirmed",
        sub: `Hi <strong style="color:#111;">{{customerName}}</strong>! We've received your payment and order <strong style="color:#111;">#{{orderNumber}}</strong> is now being prepared.`,
        itemsLabel: "Order items",
        totalLabel: "Total paid",
        nextStep: "As soon as your order ships, you'll get another email with the tracking code.",
        questions: "Questions? Get in touch",
        received: "You received this email because you made a purchase at {{storeName}}.",
      }),
    },
    es: {
      subject: "Pago confirmado — Pedido #{{orderNumber}}",
      bodyHtml: confirmationDesign({
        htmlLang: "es",
        title: "Pago confirmado — {{storeName}}",
        heading: "Pago confirmado",
        sub: `¡Hola, <strong style="color:#111;">{{customerName}}</strong>! Recibimos tu pago y el pedido <strong style="color:#111;">#{{orderNumber}}</strong> ya está siendo preparado.`,
        itemsLabel: "Artículos del pedido",
        totalLabel: "Total pagado",
        nextStep: "En cuanto tu pedido sea enviado, recibirás otro correo con el código de seguimiento.",
        questions: "¿Dudas? Contáctanos",
        received: "Recibiste este correo porque realizaste una compra en {{storeName}}.",
      }),
    },
    fr: {
      subject: "Paiement confirmé — Commande #{{orderNumber}}",
      bodyHtml: confirmationDesign({
        htmlLang: "fr",
        title: "Paiement confirmé — {{storeName}}",
        heading: "Paiement confirmé",
        sub: `Bonjour <strong style="color:#111;">{{customerName}}</strong> ! Nous avons reçu votre paiement et la commande <strong style="color:#111;">#{{orderNumber}}</strong> est en cours de préparation.`,
        itemsLabel: "Articles de la commande",
        totalLabel: "Total payé",
        nextStep: "Dès que votre commande sera expédiée, vous recevrez un autre e-mail avec le numéro de suivi.",
        questions: "Des questions ? Contactez-nous",
        received: "Vous avez reçu cet e-mail car vous avez effectué un achat chez {{storeName}}.",
      }),
    },
    de: {
      subject: "Zahlung bestätigt — Bestellung #{{orderNumber}}",
      bodyHtml: confirmationDesign({
        htmlLang: "de",
        title: "Zahlung bestätigt — {{storeName}}",
        heading: "Zahlung bestätigt",
        sub: `Hallo <strong style="color:#111;">{{customerName}}</strong>! Wir haben deine Zahlung erhalten und Bestellung <strong style="color:#111;">#{{orderNumber}}</strong> wird jetzt vorbereitet.`,
        itemsLabel: "Bestellte Artikel",
        totalLabel: "Bezahlter Betrag",
        nextStep: "Sobald deine Bestellung versandt wird, erhältst du eine weitere E-Mail mit der Sendungsnummer.",
        questions: "Fragen? Kontaktiere uns",
        received: "Du hast diese E-Mail erhalten, weil du bei {{storeName}} eingekauft hast.",
      }),
    },
  },
  payment_failed: {
    en: {
      subject: "Payment failed — Order #{{orderNumber}}",
      bodyHtml: `<h1 style="margin:18px 0 6px; font-size:20px; color:#0E0E14;">Payment failed</h1>
<p style="margin:0; font-size:14px; color:#646474;">We couldn't process the payment for your order <strong style="color:#0E0E14;">#{{orderNumber}}</strong>. Please try again — your items are still reserved for a little while.</p>`,
    },
    es: {
      subject: "Pago fallido — Pedido #{{orderNumber}}",
      bodyHtml: `<h1 style="margin:18px 0 6px; font-size:20px; color:#0E0E14;">Pago fallido</h1>
<p style="margin:0; font-size:14px; color:#646474;">No pudimos procesar el pago de tu pedido <strong style="color:#0E0E14;">#{{orderNumber}}</strong>. Por favor, inténtalo de nuevo — tus artículos siguen reservados por un tiempo.</p>`,
    },
    fr: {
      subject: "Échec du paiement — Commande #{{orderNumber}}",
      bodyHtml: `<h1 style="margin:18px 0 6px; font-size:20px; color:#0E0E14;">Échec du paiement</h1>
<p style="margin:0; font-size:14px; color:#646474;">Nous n'avons pas pu traiter le paiement de votre commande <strong style="color:#0E0E14;">#{{orderNumber}}</strong>. Veuillez réessayer — vos articles restent réservés encore un moment.</p>`,
    },
    de: {
      subject: "Zahlung fehlgeschlagen — Bestellung #{{orderNumber}}",
      bodyHtml: `<h1 style="margin:18px 0 6px; font-size:20px; color:#0E0E14;">Zahlung fehlgeschlagen</h1>
<p style="margin:0; font-size:14px; color:#646474;">Wir konnten die Zahlung für deine Bestellung <strong style="color:#0E0E14;">#{{orderNumber}}</strong> nicht verarbeiten. Bitte versuche es erneut — deine Artikel bleiben noch eine Weile reserviert.</p>`,
    },
  },
  tracking: {
    en: {
      subject: "Your order has shipped — #{{orderNumber}}",
      bodyHtml: trackingDesign({
        htmlLang: "en",
        title: "Your order has shipped — {{storeName}}",
        heading: "Your order is on its way",
        sub: `Order <span style="color:#111;font-weight:600;">#{{orderNumber}}</span> has shipped and is now in transit.`,
        carrierLabel: "Carrier",
        trackingLabel: "Tracking number",
        questions: "Questions? Reach out to us",
        received: "You received this email because you made a purchase at {{storeName}}.",
      }),
    },
    es: {
      subject: "Tu pedido ha sido enviado — #{{orderNumber}}",
      bodyHtml: trackingDesign({
        htmlLang: "es",
        title: "Tu pedido ha sido enviado — {{storeName}}",
        heading: "Tu pedido está en camino",
        sub: `El pedido <span style="color:#111;font-weight:600;">#{{orderNumber}}</span> fue despachado y ya está en ruta.`,
        carrierLabel: "Transportista",
        trackingLabel: "Número de seguimiento",
        questions: "¿Dudas? Habla con nosotros",
        received: "Recibiste este correo porque realizaste una compra en {{storeName}}.",
      }),
    },
    fr: {
      subject: "Votre commande a été expédiée — #{{orderNumber}}",
      bodyHtml: trackingDesign({
        htmlLang: "fr",
        title: "Votre commande a été expédiée — {{storeName}}",
        heading: "Votre commande est en route",
        sub: `La commande <span style="color:#111;font-weight:600;">#{{orderNumber}}</span> a été expédiée et est en cours d'acheminement.`,
        carrierLabel: "Transporteur",
        trackingLabel: "Numéro de suivi",
        questions: "Des questions ? Contactez-nous",
        received: "Vous avez reçu cet e-mail car vous avez effectué un achat chez {{storeName}}.",
      }),
    },
    de: {
      subject: "Deine Bestellung wurde versandt — #{{orderNumber}}",
      bodyHtml: trackingDesign({
        htmlLang: "de",
        title: "Deine Bestellung wurde versandt — {{storeName}}",
        heading: "Deine Bestellung ist unterwegs",
        sub: `Bestellung <span style="color:#111;font-weight:600;">#{{orderNumber}}</span> wurde versandt und ist jetzt unterwegs.`,
        carrierLabel: "Versanddienst",
        trackingLabel: "Sendungsnummer",
        questions: "Fragen? Kontaktiere uns",
        received: "Du hast diese E-Mail erhalten, weil du bei {{storeName}} eingekauft hast.",
      }),
    },
  },
};

// Idempotent — only fills in templates that don't exist yet, never overwrites an edit.
async function ensureDefaultTemplates() {
  for (const key of Object.keys(DEFAULT_TEMPLATES)) {
    for (const locale of LOCALES) {
      const def = DEFAULT_TEMPLATES[key][locale];
      if (!def) continue;
      await prisma.emailTemplate.upsert({
        where: { key_locale: { key, locale } },
        update: {},
        create: { key, locale, subject: def.subject, bodyHtml: def.bodyHtml },
      });
    }
  }
}

async function getTemplate(key, locale) {
  const wanted = LOCALES.includes(locale) ? locale : "en";
  let tpl = await prisma.emailTemplate.findUnique({ where: { key_locale: { key, locale: wanted } } });
  if (!tpl && wanted !== "en") {
    tpl = await prisma.emailTemplate.findUnique({ where: { key_locale: { key, locale: "en" } } });
  }
  return tpl;
}

module.exports = {
  TEMPLATE_VARS,
  TEMPLATE_LABELS,
  LOCALES,
  LOCALE_LABELS,
  DEFAULT_TEMPLATES,
  renderTemplate,
  ensureDefaultTemplates,
  getTemplate,
};
