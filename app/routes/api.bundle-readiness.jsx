import { authenticate } from "../shopify.server";
import { getShopifyBundleReadiness } from "../lib/shopify-bundles.server";
import { apiErrorResponse } from "../lib/http-security.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  try {
    const { admin } = await authenticate.admin(request);
    const readiness = await getShopifyBundleReadiness(admin);
    return Response.json({ ok: true, readiness });
  } catch (error) {
    return apiErrorResponse(request, error, {
      context: "Shopify bundle readiness",
      fallback: "ReleaseCore could not check Shopify bundle readiness.",
    });
  }
};
