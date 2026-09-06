const prisma = require("../db");
const { sendOrderConfirmationEmail, sendPaymentFailedEmail } = require("./mailer");

const STATUS_MAP = {
  pending: { orderStatus: "pending_payment", paymentStatus: "pending" },
  processing: { orderStatus: "processing", paymentStatus: "processing" },
  completed: { orderStatus: "paid", paymentStatus: "succeeded" },
  failed: { orderStatus: "payment_failed", paymentStatus: "failed" },
  expired: { orderStatus: "payment_failed", paymentStatus: "failed" },
  refunded: { orderStatus: "refunded", paymentStatus: "refunded" },
};

// Applies a SouthPay checkout/payment status to our local Order + Payment records.
// Used by both the polling endpoint and the webhook handler so behavior stays consistent.
async function syncOrderFromProviderStatus({ reference, providerStatus, providerTxid, providerName, source }) {
  const mapping = STATUS_MAP[providerStatus];
  if (!mapping) return null;

  const order = await prisma.order.findUnique({
    where: { southpayReference: reference },
    include: { items: true, payments: true },
  });
  if (!order) return null;

  const wasPaid = order.status === "paid";

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      status: mapping.orderStatus,
      paymentStatus: mapping.paymentStatus,
      southpayProviderTxid: providerTxid || order.southpayProviderTxid,
      southpayProviderName: providerName || order.southpayProviderName,
      paidAt: mapping.orderStatus === "paid" ? order.paidAt || new Date() : order.paidAt,
      cancelledAt: mapping.orderStatus === "cancelled" ? new Date() : order.cancelledAt,
    },
    include: { items: true },
  });

  const payment = order.payments[0];
  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: mapping.paymentStatus,
        providerTxid: providerTxid || payment.providerTxid,
        providerName: providerName || payment.providerName,
      },
    });

    await prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        provider: "southpay",
        sessionId: reference,
        status: mapping.paymentStatus,
        amount: payment.amount,
        currency: payment.currency,
        providerName: providerName || null,
        providerTxid: providerTxid || null,
        errorCode: mapping.paymentStatus === "failed" ? "payment_failed" : null,
        errorMessage: mapping.paymentStatus === "failed" ? `Payment ${providerStatus} (source: ${source})` : null,
      },
    });
  }

  if (!wasPaid && mapping.orderStatus === "paid") {
    await prisma.checkoutSession.updateMany({
      where: { orderId: order.id, status: { not: "completed" } },
      data: { status: "completed", completedAt: new Date() },
    });
    await sendOrderConfirmationEmail(updated).catch((err) => console.error("order email failed:", err));
  } else if (mapping.paymentStatus === "failed") {
    await sendPaymentFailedEmail(updated).catch((err) => console.error("failed-payment email failed:", err));
  }

  return updated;
}

module.exports = { syncOrderFromProviderStatus, STATUS_MAP };
