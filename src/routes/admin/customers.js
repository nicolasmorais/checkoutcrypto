const express = require("express");
const prisma = require("../../db");

const router = express.Router();

router.get("/", async (req, res) => {
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      orders: { select: { total: true, paymentStatus: true, createdAt: true } },
      addresses: { take: 1, orderBy: { createdAt: "desc" } },
    },
  });

  const rows = customers.map((c) => {
    const paidOrders = c.orders.filter((o) => o.paymentStatus === "succeeded");
    const revenue = paidOrders.reduce((sum, o) => sum + o.total, 0);
    const lastOrder = c.orders.sort((a, b) => b.createdAt - a.createdAt)[0];
    return {
      ...c,
      orderCount: c.orders.length,
      revenue,
      country: c.addresses[0]?.country || "—",
      lastOrderAt: lastOrder?.createdAt || null,
    };
  });

  res.render("admin/customers/list", { customers: rows });
});

router.get("/:id", async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { id: req.params.id },
    include: {
      addresses: { orderBy: { createdAt: "desc" } },
      orders: { orderBy: { createdAt: "desc" }, include: { items: true } },
    },
  });
  if (!customer) return res.status(404).render("admin/not-found", { entity: "Customer" });

  res.render("admin/customers/detail", { customer });
});

module.exports = router;
