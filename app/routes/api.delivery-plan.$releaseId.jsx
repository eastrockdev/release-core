import { authenticate } from "../shopify.server";
import {
  removeReleaseDeliveryChannel,
  saveReleaseDeliveryChannel,
  saveReleaseDeliveryPlan,
} from "../lib/delivery-plan.server";
import { apiErrorResponse } from "../lib/http-security.server";

export const action = async ({ request, params }) => {
  if (request.method !== "POST") {
    return Response.json(
      {
        ok: false,
        error: "Method not allowed.",
      },
      { status: 405 },
    );
  }

  try {
    const { session } =
      await authenticate.admin(request);
    const formData =
      await request.formData();
    const releaseId = String(
      params.releaseId || "",
    );
    const intent = String(
      formData.get("intent") || "",
    );

    if (intent === "save-plan") {
      await saveReleaseDeliveryPlan({
        shop: session.shop,
        releaseId,
        channelMode: formData.get("channelMode"),
        channelKeys:
          formData.getAll("channelKeys"),
        territoryMode:
          formData.get("territoryMode"),
        territoryCodes:
          formData.getAll("territoryCodes"),
        exclusiveChannelKey:
          formData.get("exclusiveChannelKey"),
        exclusiveStartDate:
          formData.get("exclusiveStartDate"),
        exclusiveEndDate:
          formData.get("exclusiveEndDate"),
        notes: formData.get("notes"),
      });

      return Response.json({
        ok: true,
        message: "Delivery plan saved.",
      });
    }

    if (intent === "save-channel") {
      await saveReleaseDeliveryChannel({
        shop: session.shop,
        releaseId,
        channelKey:
          formData.get("channelKey"),
        enabledState:
          formData.get("enabledState"),
        releaseDate:
          formData.get("releaseDate"),
        territoryMode:
          formData.get("territoryMode"),
        territoryCodes:
          formData.getAll("territoryCodes"),
        notes: formData.get("notes"),
      });

      return Response.json({
        ok: true,
        message:
          "Platform exception saved.",
      });
    }

    if (intent === "remove-channel") {
      await removeReleaseDeliveryChannel({
        shop: session.shop,
        releaseId,
        channelKey:
          formData.get("channelKey"),
      });

      return Response.json({
        ok: true,
        message:
          "Platform exception removed.",
      });
    }

    return Response.json(
      {
        ok: false,
        error:
          "Unknown delivery-plan action.",
      },
      { status: 400 },
    );
  } catch (error) {
    return apiErrorResponse(
      request,
      error,
      {
        context: "delivery plan",
        fallback:
          "ReleaseCore could not update the delivery plan.",
      },
    );
  }
};
