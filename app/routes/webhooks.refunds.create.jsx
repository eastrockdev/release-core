import { authenticate } from "../shopify.server";
import { processRefund } from "../lib/commerce-entitlements.server";

export const action = async ({ request }) => {
  const { payload, shop } = await authenticate.webhook(request);
  await processRefund({ shop, payload });
  return new Response(null, { status: 200 });
};
