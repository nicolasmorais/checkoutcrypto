function formatMoney(cents, currency) {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(
    cents / 100
  );
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function adminLocals(req, res, next) {
  res.locals.formatMoney = formatMoney;
  res.locals.formatDate = formatDate;
  res.locals.req = req;
  next();
}

module.exports = adminLocals;
