import { authenticate } from "../shopify.server";
import {
  createBlankReleaseDraft,
  createDraftFromTemplate,
  duplicateReleaseDraft,
} from "../lib/release-templates.server";
import { apiErrorResponse } from "../lib/http-security.server";

export const action = async ({ request }) => {
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

    const type = String(
      formData.get("type") || "",
    ).toUpperCase();
    const requestedTitle = String(
      formData.get("title") || "",
    ).trim();
    const templateId = String(
      formData.get("templateId") || "",
    ).trim();
    const duplicateReleaseId = String(
      formData.get("duplicateReleaseId") ||
        "",
    ).trim();

    if (
      templateId &&
      duplicateReleaseId
    ) {
      return Response.json(
        {
          ok: false,
          error:
            "Choose either a release template or an existing release to duplicate, not both.",
        },
        { status: 400 },
      );
    }

    let release;

    if (duplicateReleaseId) {
      release =
        await duplicateReleaseDraft({
          shop: session.shop,
          sourceReleaseId:
            duplicateReleaseId,
          requestedTitle,
        });
    } else if (templateId) {
      release =
        await createDraftFromTemplate({
          shop: session.shop,
          templateId,
          requestedTitle,
        });
    } else {
      release =
        await createBlankReleaseDraft({
          shop: session.shop,
          type,
          requestedTitle,
        });
    }

    return Response.json({
      ok: true,
      releaseId: release.id,
      type: release.type,
      title: release.title,
    });
  } catch (error) {
    return apiErrorResponse(
      request,
      error,
      {
        context: "create release",
        fallback:
          "ReleaseCore could not create the draft.",
      },
    );
  }
};
