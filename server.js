require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");

const requireAdmin = require("./src/middleware/requireAdmin");
const adminLocals = require("./src/middleware/adminLocals");

const publicApiRouter = require("./src/routes/publicApi");
const webhooksRouter = require("./src/routes/webhooks");
const adminAuthRouter = require("./src/routes/admin/auth");
const adminDashboardRouter = require("./src/routes/admin/dashboard");
const adminProductsRouter = require("./src/routes/admin/products");
const adminOrdersRouter = require("./src/routes/admin/orders");
const adminCustomersRouter = require("./src/routes/admin/customers");
const adminSettingsRouter = require("./src/routes/admin/settings");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ── Public checkout API (unchanged behavior, now DB-backed) ────────
app.use("/api", publicApiRouter);

// ── SouthPay webhooks ────────────────────────────────────────────
app.use("/api/webhooks", webhooksRouter);

// ── Admin ────────────────────────────────────────────────────────
app.use("/admin", adminAuthRouter); // /admin/login, /admin/logout (public)
app.use("/admin", requireAdmin, adminLocals, adminDashboardRouter);
app.use("/admin/products", requireAdmin, adminLocals, adminProductsRouter);
app.use("/admin/orders", requireAdmin, adminLocals, adminOrdersRouter);
app.use("/admin/customers", requireAdmin, adminLocals, adminCustomersRouter);
app.use("/admin/settings", requireAdmin, adminLocals, adminSettingsRouter);

// ── Start Server ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  SouthPay Checkout Server`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Checkout:  http://localhost:${PORT}`);
  console.log(`  Admin:     http://localhost:${PORT}/admin/login\n`);

  require("./src/lib/emailTemplates")
    .ensureDefaultTemplates()
    .catch((err) => console.error("Failed to seed default email templates:", err));
});
