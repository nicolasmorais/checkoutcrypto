const express = require("express");
const prisma = require("../../db");
const { ciContains } = require("../../lib/queryHelpers");
const { sendTrackingEmail } = require("../../lib/mailer");

const router = express.Router();

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function daysAgo(n) {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return startOfDay(x);
}

router.get("/", async (req, res) => {
  const { range, from, to, paymentStatus, country, product: productFilter, q } = req.query;

  const where = {};

  if (range === "today") where.createdAt = { gte: startOfDay(new Date()) };
  else if (range === "yesterday") {
    const y = daysAgo(1);
    const t = startOfDay(new Date());
    where.createdAt = { gte: y, lt: t };
  } else if (range === "7d") where.createdAt = { gte: daysAgo(7) };
  else if (range === "30d") where.createdAt = { gte: daysAgo(30) };
  else if (range === "custom" && from) {
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59, 999);
    where.createdAt = { gte: startOfDay(new Date(from)), lte: toDate };
  }

  if (paymentStatus) where.paymentStatus = paymentStatus;

  if (country) where.shippingAddress = { country };

  if (productFilter) where.items = { some: { name: ciContains(productFilter) } };

  if (q) {
    where.OR = [
      { orderNumber: ciContains(q) },
      { email: ciContains(q) },
      { customer: { fullName: ciContains(q) } },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { items: true, customer: true, shippingAddress: true },
  });

  res.render("admin/orders/list", { orders, filters: req.query });
});

router.get("/:id", async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      items: { include: { product: true, variant: true } },
      customer: true,
      shippingAddress: true,
      payments: { include: { attempts: true } },
      paymentAttempts: { orderBy: { createdAt: "desc" } },
      checkoutSessions: true,
    },
  });
  if (!order) return res.status(404).render("admin/not-found", { entity: "Order" });

  // Filtered in JS rather than via a JSON-path DB query, since JSON path
  // filtering isn't portable across every Prisma-supported database.
  const recentWebhookEvents = await prisma.webhookEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const webhookEvents = order.southpayReference
    ? recentWebhookEvents.filter((w) => {
        const p = w.payload || {};
        const ref = p.reference || p.token || p.checkout_reference || p.data?.reference || p.data?.token;
        return ref === order.southpayReference;
      })
    : [];

  res.render("admin/orders/detail", {
    order,
    webhookEvents,
    trackingSaved: req.query.trackingSaved === "1",
    trackingError: req.query.trackingError === "1",
  });
});

router.post("/:id/status", async (req, res) => {
  const { status } = req.body;
  const valid = ["checkout_started", "pending_payment", "processing", "paid", "payment_failed", "cancelled", "refunded"];
  if (!valid.includes(status)) return res.redirect(`/admin/orders/${req.params.id}`);

  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).render("admin/not-found", { entity: "Order" });

  await prisma.order.update({
    where: { id: order.id },
    data: { status, cancelledAt: status === "cancelled" ? new Date() : order.cancelledAt },
  });

  const { logAudit } = require("../../lib/audit");
  await logAudit({
    adminUserId: req.adminUser.id,
    action: "order.status_changed",
    entity: "Order",
    entityId: order.id,
    metadata: { from: order.status, to: status },
  });

  res.redirect(`/admin/orders/${order.id}`);
});

router.post("/:id/tracking", async (req, res) => {
  const { trackingCarrier, trackingNumber, trackingUrl, sendEmail } = req.body;

  const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).render("admin/not-found", { entity: "Order" });

  const order = await prisma.order.update({
    where: { id: existing.id },
    data: {
      trackingCarrier: trackingCarrier || null,
      trackingNumber: trackingNumber || null,
      trackingUrl: trackingUrl || null,
    },
    include: { items: true },
  });

  const { logAudit } = require("../../lib/audit");
  await logAudit({
    adminUserId: req.adminUser.id,
    action: "order.tracking_updated",
    entity: "Order",
    entityId: order.id,
    metadata: { trackingCarrier, trackingNumber },
  });

  if (sendEmail === "on" && order.trackingNumber) {
    try {
      await sendTrackingEmail(order);
      await prisma.order.update({ where: { id: order.id }, data: { trackingSentAt: new Date() } });
    } catch (err) {
      console.error("tracking email failed:", err);
      return res.redirect(`/admin/orders/${order.id}?trackingError=1`);
    }
  }

  res.redirect(`/admin/orders/${order.id}?trackingSaved=1`);
});

module.exports = router;
