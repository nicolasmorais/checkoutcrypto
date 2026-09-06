const express = require("express");
const crypto = require("crypto");
const prisma = require("../../db");
const { createSessionToken, setSessionCookie, clearSessionCookie } = require("../../lib/auth");
const { logAudit } = require("../../lib/audit");

const router = express.Router();

// Constant-time compare — a plain === would leak how many leading
// characters matched via response timing.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

router.get("/login", (req, res) => {
  res.render("admin/login", { error: null });
});

// Single shared password from ADMIN_PASSWORD — no per-user login. The
// AdminUser row still exists (keyed by ADMIN_EMAIL) purely so sessions and
// audit log entries have something to reference.
router.post("/login", async (req, res) => {
  const { password } = req.body;
  const expected = process.env.ADMIN_PASSWORD;

  if (!password || !expected || !safeEqual(password, expected)) {
    return res.render("admin/login", { error: "Invalid password" });
  }

  const email = (process.env.ADMIN_EMAIL || "admin@example.com").toLowerCase().trim();
  const adminUser = await prisma.adminUser.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: "env", name: "Admin" },
  });

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
