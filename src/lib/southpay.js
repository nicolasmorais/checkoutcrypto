const API_URL = process.env.SOUTHPAY_API_URL || "https://api.southpay.io/api/v2";
const API_KEY = process.env.SOUTHPAY_SECRET_KEY;

function extractError(data) {
  // Most endpoints return {"error": ...}; validation failures (422) return
  // {"errors": ["message", ...]} instead — see the webhook endpoints docs.
  if (Array.isArray(data?.errors) && data.errors.length) return data.errors.join(", ");
  if (!data?.error) return "Unknown API error";
  if (typeof data.error === "string") return data.error;
  return data.error.message || data.error.code || JSON.stringify(data.error);
}

class SouthPayError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 500;
  }
}

async function southpayFetch(pathname, options = {}) {
  const response = await fetch(`${API_URL}${pathname}`, options);
  const data = await response.json();
  if (!response.ok) throw new SouthPayError(extractError(data), response.status);
  return data;
}

function authHeaders() {
  return { Authorization: `Bearer ${API_KEY}` };
}

module.exports = { API_URL, API_KEY, southpayFetch, authHeaders, extractError, SouthPayError };
