import { authenticate } from "../shopify.server";
import { enqueuePrivacyRequest, PRIVACY_TOPICS, processPrivacyRequestById } from "../lib/privacy.server";

function normalizeTopic(topic) {
  const value = String(topic || "").trim();
  const upper = value.toUpperCase();
  if (upper === "CUSTOMERS_DATA_REQUEST") return PRIVACY_TOPICS.DATA_REQUEST;
  if (upper === "CUSTOMERS_REDACT") return PRIVACY_TOPICS.CUSTOMER_REDACT;
  if (upper === "SHOP_REDACT") return PRIVACY_TOPICS.SHOP_REDACT;
  return value.toLowerCase();
}

export const action = async ({ request }) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  const normalizedTopic = normalizeTopic(topic);
  const privacyRequest = await enqueuePrivacyRequest({
    shop,
    topic: normalizedTopic,
    payload,
  });

  // Shopify expects webhook acknowledgements quickly. The request is durable in
  // PostgreSQL before processing begins, so acknowledge immediately and let the
  // long-running export/redaction work continue without blocking delivery.
  void processPrivacyRequestById(privacyRequest.id).catch(() => {
    // The privacy service records a sanitized failure on the request and logs it.
  });
  return new Response(null, { status: 200 });
};
