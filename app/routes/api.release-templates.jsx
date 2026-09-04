import { authenticate } from "../shopify.server";
import {
  createReleaseTemplate,
  deleteReleaseTemplate,
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
    const intent = String(
      formData.get("intent") || "",
    );

    if (intent === "create") {
      const template =
        await createReleaseTemplate({
          shop: session.shop,
          sourceReleaseId: String(
            formData.get("sourceReleaseId") ||
              "",
          ),
          name: String(
            formData.get("name") || "",
          ),
          description: String(
            formData.get("description") ||
              "",
          ),
        });

      return Response.json({
        ok: true,
        template,
        message: `Template “${template.name}” created.`,
      });
    }

    if (intent === "delete") {
      const template =
        await deleteReleaseTemplate({
          shop: session.shop,
          templateId: String(
            formData.get("templateId") ||
              "",
          ),
        });

      return Response.json({
        ok: true,
        message: `Template “${template.name}” deleted.`,
      });
    }

    return Response.json(
      {
        ok: false,
        error:
          "Unknown release-template action.",
      },
      { status: 400 },
    );
  } catch (error) {
    return apiErrorResponse(
      request,
      error,
      {
        context: "release templates",
        fallback:
          "ReleaseCore could not complete this template action.",
      },
    );
  }
};
