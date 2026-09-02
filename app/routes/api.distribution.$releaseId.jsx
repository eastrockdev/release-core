import { authenticate } from "../shopify.server";
import { performDistributionAction } from "../lib/distribution.server";
import { apiErrorResponse } from "../lib/http-security.server";

export const action = async ({ request, params }) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  try {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const result = await performDistributionAction({
      admin,
      shop: session.shop,
      releaseId: params.releaseId,
      formData,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return apiErrorResponse(request, error, {
      context: "distribution mutation",
      fallback: "ReleaseCore could not update distribution.",
    });
  }
};
