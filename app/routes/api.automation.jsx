import { authenticate } from "../shopify.server";
import { performAutomationSettingsAction } from "../lib/automation-settings.server";
import { apiErrorResponse } from "../lib/http-security.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    const form = await request.formData();
    const result = await performAutomationSettingsAction({
      shop: session.shop,
      form,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return apiErrorResponse(request, error, {
      context: "automation settings",
      fallback: "Could not process automation settings.",
    });
  }
};
