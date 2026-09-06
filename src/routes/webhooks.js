const express = require("express");
const crypto = require("crypto");
const prisma = require("../db");
const { syncOrderFromProviderStatus } = require("../lib/orderSync");

const router = express.Router();

// SouthPay does not enforce a delivery timestamp tolerance itself — this is
// our own replay-protection window, per their own recommendation.
const SIGNATURE_TOLERANCE_SECONDS = 300;

// SouthPay signs deliveries as `Southpay-Signature: t=<unix seconds>,v1=<hex hmac>`,
// over the raw body string `${t}.${rawBody}`, keyed with the whsec_... secret
// exactly as issued (no prefix stripped, no decoding).
function verifySignature(req) {
  const secret = process.env.SOUTHPAY_WEBHOOK_SECRET;
  if (!secret) return true; // no secret configured — skip verification (dev/testing only)

  const header = req.get("Southpay-Signature");
  if (!header) return false;

  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    })
  );
  if (!parts.t || !parts.v1) return false;

  const age = Math.floor(Date.now() / 1000) - Number(parts.t);
  if (!Number.isFinite(age) || Math.abs(age) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts.t}.${req.rawBody || ""}`)
    .digest("hex");

  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(parts.v1);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// SouthPay webhook receiver. Idempotent via unique (provider, eventId).
router.post("/southpay", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const payload = req.body || {};
  const eventId = payload.id || crypto.randomUUID();
  const eventType = payload.type || "unknown";

  let event;
  try {
    event = await prisma.webhookEvent.create({
      data: { provider: "southpay", eventId: String(eventId), eventType, payload },
    });
  } catch (err) {
    if (err.code === "P2002") {
      // duplicate delivery — already recorded, ack without reprocessing
      return res.status(200).json({ received: true, duplicate: true });
    }
    console.error("Failed to store webhook event:", err);
    return res.status(500).json({ error: "Internal server error" });
  }

  try {
    // payment_intent.* and transaction.* events carry a compact 7-key summary
    // in data.object: id (the payment intent's REFERENCE, not a UUID), status,
    // settlement_amount_cents, settlement_currency, from_status, to_status,
    // metadata. There is no txid/coin info on this envelope — that only shows
    // up on the full checkout/payment fetch, not on the webhook payload.
    const object = payload.data?.object;
    const reference = object?.id;
    const status = object?.status;

    if (reference && status) {
      await syncOrderFromProviderStatus({
        reference,
        providerStatus: status,
        providerTxid: null,
        providerName: null,
        source: "webhook",
      });
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processed: true, processedAt: new Date() },
    });

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    await prisma.webhookEvent
      .update({ where: { id: event.id }, data: { error: String(err.message || err) } })
      .catch(() => {});
    // Ack anyway — SouthPay retries every non-2xx (including our own bugs) for
    // up to ~18 hours, so only withhold 2xx when we actually want a retry.
    res.status(200).json({ received: true, error: "processing_failed" });
  }
});

module.exports = router;
