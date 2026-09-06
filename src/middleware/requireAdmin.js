const prisma = require("../db");
const { SESSION_COOKIE, verifySessionToken } = require("../lib/auth");

async function requireAdmin(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const payload = token && verifySessionToken(token);

  if (!payload) {
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
    return res.redirect("/admin/login");
  }

  const adminUser = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
  if (!adminUser || !adminUser.active) {
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
    return res.redirect("/admin/login");
  }

  req.adminUser = adminUser;
  res.locals.adminUser = adminUser;
  next();
}

module.exports = requireAdmin;
