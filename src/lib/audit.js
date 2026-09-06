const prisma = require("../db");

async function logAudit({ adminUserId, action, entity, entityId, metadata }) {
  try {
    await prisma.auditLog.create({
      data: { adminUserId, action, entity, entityId, metadata: metadata || undefined },
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

module.exports = { logAudit };
