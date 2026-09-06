const { southpayFetch, authHeaders } = require("./southpay");

// The payment_intent events our sync logic actually consumes (see
// src/lib/orderSync.js STATUS_MAP) — transaction.*, invoice.*, subscription.*
// and store.verification.* are not requested since nothing acts on them yet.
const SUBSCRIBED_EVENTS = [
  "payment_intent.created",
  "payment_intent.processing",
  "payment_intent.completed",
  "payment_intent.failed",
  "payment_intent.expired",
  "payment_intent.refunded",
];

function listEndpoints() {
  return southpayFetch("/webhook_endpoints", { headers: authHeaders() });
}

function createEndpoint(url) {
  return southpayFetch("/webhook_endpoints", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      webhook_endpoint: {
        url,
        description: "Order fulfillment handler",
        subscribed_events: SUBSCRIBED_EVENTS,
      },
    }),
  });
}

function updateEndpointEvents(id, url) {
  return southpayFetch(`/webhook_endpoints/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ webhook_endpoint: { url, subscribed_events: SUBSCRIBED_EVENTS } }),
  });
}

function rotateSecret(id) {
  return southpayFetch(`/webhook_endpoints/${id}/rotate_secret`, {
    method: "POST",
    headers: authHeaders(),
  });
}

module.exports = { SUBSCRIBED_EVENTS, listEndpoints, createEndpoint, updateEndpointEvents, rotateSecret };
