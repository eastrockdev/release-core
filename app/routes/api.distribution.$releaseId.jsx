import { authenticate } from "../shopify.server";
import { performDistributionAction } from "../lib/distribution.server";
import { apiErrorResponse, safeDiagnosticText } from "../lib/http-security.server";
import { recordDistributionFailure } from "../lib/distribution-health.server";

export const action = async ({ request, params }) => {
  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "Method not allowed." },
      { status: 405 },
    );
  }

  let shop = null;
  let intent = null;

  try {
    const { admin, session } = await authenticate.admin(request);
    shop = session.shop;

    const formData = await request.formData();
    intent = String(formData.get("intent") || "");

    const result = await performDistributionAction({
      admin,
      shop,
      releaseId: params.releaseId,
      formData,
    });

    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (shop && params.releaseId && intent) {
      try {
        await recordDistributionFailure({
          shop,
          releaseId: params.releaseId,
          intent,
          error,
        });
      } catch (logError) {
        console.warn("ReleaseCore sync-health failure event could not be saved", {
          message: safeDiagnosticText(
            logError instanceof Error
              ? logError.message
              : String(logError || ""),
            700,
          ),
        });
      }
    }

    return apiErrorResponse(request, error, {
      context: "distribution mutation",
      fallback: "ReleaseCore could not update distribution.",
      shop,
    });
  }
};
