const express = require("express");
const prisma = require("../../db");

const router = express.Router();

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function daysAgo(n) {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return startOfDay(x);
}

function resolveRange(query) {
  const range = ["today", "7d", "30d", "90d", "custom"].includes(query.range) ? query.range : "30d";
  const now = new Date();

  if (range === "custom" && query.from) {
    const from = startOfDay(new Date(query.from));
    const to = query.to ? endOfDay(new Date(query.to)) : now;
    return { range, from, to };
  }
  if (range === "today") return { range, from: startOfDay(now), to: now };
  if (range === "7d") return { range, from: daysAgo(7), to: now };
  if (range === "90d") return { range, from: daysAgo(90), to: now };
  return { range: "30d", from: daysAgo(30), to: now };
}

router.get("/", (req, res) => res.redirect("/admin/dashboard"));

router.get("/dashboard", async (req, res) => {
  const { range, from, to } = resolveRange(req.query);
  const spanMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - spanMs);

  const [
    revenueAgg,
    prevRevenueAgg,
    ordersCount,
    prevOrdersCount,
    paidOrders,
    pendingPayments,
    failedPayments,
    checkoutStarts,
    paymentRedirects,
    completedSessions,
    recentOrders,
    ordersForChart,
  ] = await Promise.all([
    prisma.order.aggregate({ _sum: { total: true }, where: { paymentStatus: "succeeded", paidAt: { gte: from, lte: to } } }),
    prisma.order.aggregate({ _sum: { total: true }, where: { paymentStatus: "succeeded", paidAt: { gte: prevFrom, lt: prevTo } } }),
    prisma.order.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.order.count({ where: { createdAt: { gte: prevFrom, lt: prevTo } } }),
    prisma.order.count({ where: { paymentStatus: "succeeded", paidAt: { gte: from, lte: to } } }),
    prisma.order.count({ where: { paymentStatus: "pending", createdAt: { gte: from, lte: to } } }),
    prisma.order.count({ where: { paymentStatus: "failed", createdAt: { gte: from, lte: to } } }),
    prisma.checkoutSession.count({ where: { startedAt: { gte: from, lte: to } } }),
    prisma.checkoutSession.count({ where: { paymentRedirectedAt: { not: null }, startedAt: { gte: from, lte: to } } }),
    prisma.checkoutSession.count({ where: { status: "completed", startedAt: { gte: from, lte: to } } }),
    prisma.order.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { items: true, customer: true },
    }),
    prisma.order.findMany({
      where: { paymentStatus: "succeeded", paidAt: { gte: from, lte: to } },
      select: { paidAt: true, total: true },
    }),
  ]);

  const revenue = revenueAgg._sum.total || 0;
  const prevRevenue = prevRevenueAgg._sum.total || 0;
  const avgOrderValue = paidOrders > 0 ? Math.round(revenue / paidOrders) : 0;
  const conversionRate = checkoutStarts > 0 ? ((completedSessions / checkoutStarts) * 100).toFixed(1) : "0.0";

  function trend(current, prev) {
    if (prev === 0) return current > 0 ? { pct: 100, up: true } : { pct: 0, up: true };
    const pct = ((current - prev) / prev) * 100;
    return { pct: Math.abs(pct).toFixed(1), up: pct >= 0 };
  }

  const chartMap = {};
  for (const o of ordersForChart) {
    const key = startOfDay(o.paidAt).toISOString().slice(0, 10);
    chartMap[key] = (chartMap[key] || 0) + o.total;
  }
  const chartData = Object.entries(chartMap)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, total]) => ({ date, total }));

  res.render("admin/dashboard", {
    filters: { range, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    metrics: {
      revenue,
      revenueTrend: trend(revenue, prevRevenue),
      orders: ordersCount,
      ordersTrend: trend(ordersCount, prevOrdersCount),
      paidOrders,
      pendingPayments,
      failedPayments,
      avgOrderValue,
      checkoutStarts,
      paymentRedirects,
      conversionRate,
    },
    recentOrders,
    chartData,
  });
});

module.exports = router;
