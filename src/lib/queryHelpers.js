// `mode: "insensitive"` is a Postgres/MySQL-only Prisma feature; SQLite's
// `contains` is already case-insensitive for ASCII, and errors if `mode` is passed.
const isSqlite = (process.env.DATABASE_URL || "").startsWith("file:");

function ciContains(value) {
  return isSqlite ? { contains: value } : { contains: value, mode: "insensitive" };
}

module.exports = { ciContains, isSqlite };
