import { authenticate } from "../shopify.server";
import db from "../db.server";
import { PRIVACY_TOPICS } from "../lib/privacy";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const privacyRequest = await db.privacyRequest.findFirst({
    where: {
      id: params.requestId,
      shop: session.shop,
      topic: PRIVACY_TOPICS.DATA_REQUEST,
      status: "COMPLETED",
    },
    select: { id: true, shop: true, topic: true, shopifyRequestId: true, customerId: true, customerEmail: true, status: true },
  });

  if (!privacyRequest) return new Response("Customer data export not found.", { status: 404 });
  const { buildCustomerDataExport } = await import("../lib/privacy.server");
  const resultJson = await buildCustomerDataExport(privacyRequest);
  const filename = `releasecore-customer-data-${String(privacyRequest.shopifyRequestId).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
  return new Response(JSON.stringify(resultJson, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
