const express = require("express");
const prisma = require("../../db");
const { verifyPassword, createSessionToken, setSessionCookie, clearSessionCookie } = require("../../lib/auth");
const { logAudit } = require("../../lib/audit");

const router = express.Router();

router.get("/login", (req, res) => {
  res.render("admin/login", { error: null });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render("admin/login", { error: "Email and password are required" });
  }

  const adminUser = await prisma.adminUser.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!adminUser || !adminUser.active) {
    return res.render("admin/login", { error: "Invalid credentials" });
  }

  const valid = await verifyPassword(password, adminUser.passwordHash);
  if (!valid) {
    return res.render("admin/login", { error: "Invalid credentials" });
  }

  const token = createSessionToken(adminUser);
  setSessionCookie(res, token);

  await logAudit({ adminUserId: adminUser.id, action: "login", entity: "AdminUser", entityId: adminUser.id });

  res.redirect("/admin/dashboard");
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.redirect("/admin/login");
});

module.exports = router;
