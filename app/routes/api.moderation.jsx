import { authenticate } from "../shopify.server";
import {
  setCustomerReleaseCreationDisabled,
  setReleaseArtistEditLock,
} from "../lib/moderation.server";
import { apiErrorResponse } from "../lib/http-security.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "Method not allowed." },
      { status: 405 },
    );
  }

  try {
    const { session } = await authenticate.admin(request);
    const form = await request.formData();
    const intent = String(form.get("intent") || "");

    if (intent === "set-release-creation") {
      const disabled =
        String(form.get("disabled") || "false") === "true";
      const result = await setCustomerReleaseCreationDisabled({
        shop: session.shop,
        customerId: form.get("customerId"),
        disabled,
        reason: form.get("reason"),
        actorLabel: "Shopify admin",
      });

      return Response.json({
        ok: true,
        message: disabled
          ? `Release creation disabled for customer ${result.customerId}.`
          : `Release creation restored for customer ${result.customerId}.`,
      });
    }

    if (intent === "set-release-lock") {
      const locked =
        String(form.get("locked") || "false") === "true";
      const releaseId = String(form.get("releaseId") || "");

      await setReleaseArtistEditLock({
        shop: session.shop,
        releaseId,
        locked,
        reason: form.get("reason"),
        actorLabel: "Shopify admin",
      });

      return Response.json({
        ok: true,
        message: locked
          ? "Artist editing locked for this release."
          : "Artist editing unlocked for this release.",
      });
    }

    return Response.json(
      { ok: false, error: "Unknown moderation action." },
      { status: 400 },
    );
  } catch (error) {
    return apiErrorResponse(request, error, {
      context: "moderation mutation",
      fallback: "ReleaseCore could not update moderation controls.",
    });
  }
};
