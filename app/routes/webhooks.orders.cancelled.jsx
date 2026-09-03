import { authenticate } from "../shopify.server";
import { processCancelledOrder } from "../lib/commerce-entitlements.server";

export const action = async ({ request }) => {
  const { payload, shop } = await authenticate.webhook(request);
  await processCancelledOrder({ shop, payload });
  return new Response(null, { status: 200 });
};
