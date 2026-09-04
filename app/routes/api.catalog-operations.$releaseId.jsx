import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  createCatalogLifecycleRequest,
  getCatalogLifecycleRequestIdentity,
  setManualCatalogNumber,
  transitionCatalogLifecycleRequest,
} from "../lib/catalog-operations.server";
import {
  normalizeManualCatalogNumber,
} from "../lib/catalog-operations";
import {
  apiErrorResponse,
  publicError,
} from "../lib/http-security.server";
import {
  claimHighImpactMutation,
} from "../lib/production-safety.server";

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

  let issueShop = null;
  let issueIntent = "catalog operation";

  try {
    const { session } =
      await authenticate.admin(request);
    issueShop = session.shop;

    const releaseId = String(
      params.releaseId || "",
    ).trim();
    const formData =
      await request.formData();
    const intent = String(
      formData.get("intent") || "",
    );
    issueIntent = intent || "catalog operation";

    if (intent === "set-catalog-number") {
      let nextCode;
      try {
        nextCode = normalizeManualCatalogNumber(
          formData.get("catalogNumber"),
        );
      } catch (error) {
        throw publicError(
          error instanceof Error
            ? error.message
            : "Enter a valid catalog number.",
          {
            status: 400,
            code: "INVALID_CATALOG_NUMBER",
          },
        );
      }

      const current = await db.release.findFirst({
        where: {
          id: releaseId,
          shop: session.shop,
        },
        select: {
          id: true,
          catalogNumber: true,
        },
      });

      if (!current) {
        throw publicError("Release not found.", {
          status: 404,
          code: "RELEASE_NOT_FOUND",
        });
      }

      if (
        current.catalogNumber &&
        current.catalogNumber !== nextCode
      ) {
        await claimHighImpactMutation({
          request,
          shop: session.shop,
          operation: "change-catalog-number",
          entityType: "RELEASE",
          entityId: releaseId,
          confirmation: String(
            formData.get("safetyConfirmation") || "",
          ),
          expectedConfirmation:
            "CHANGE CATALOG NUMBER",
        });
      }

      const result = await setManualCatalogNumber({
        shop: session.shop,
        releaseId,
        value: nextCode,
        actorLabel: "Shopify admin",
      });

      return Response.json({
        ok: true,
        message: result.changed
          ? result.corrected
            ? `Catalog number changed to ${result.code}.`
            : `Catalog number ${result.code} assigned.`
          : `Catalog number is already ${result.code}.`,
      });
    }

    if (intent === "create-operation") {
      const type = String(
        formData.get("type") || "",
      ).toUpperCase();

      if (type === "TAKEDOWN") {
        await claimHighImpactMutation({
          request,
          shop: session.shop,
          operation: "request-release-takedown",
          entityType: "RELEASE",
          entityId: releaseId,
          confirmation: String(
            formData.get("safetyConfirmation") || "",
          ),
          expectedConfirmation:
            "REQUEST TAKEDOWN",
        });
      }

      const created =
        await createCatalogLifecycleRequest({
          shop: session.shop,
          releaseId,
          type,
          category:
            formData.get("category"),
          trackId:
            formData.get("trackId"),
          summary:
            formData.get("summary"),
          reason:
            formData.get("reason"),
          effectiveDate:
            formData.get("effectiveDate"),
          actorLabel: "Shopify admin",
        });

      return Response.json({
        ok: true,
        requestId: created.id,
        message:
          type === "TAKEDOWN"
            ? "Takedown request recorded."
            : `${type === "UPDATE" ? "Update" : "Correction"} request recorded.`,
      });
    }

    if (intent === "transition-operation") {
      const requestId = String(
        formData.get("requestId") || "",
      ).trim();
      const nextStatus = String(
        formData.get("nextStatus") || "",
      ).toUpperCase();

      const identity =
        await getCatalogLifecycleRequestIdentity({
          shop: session.shop,
          releaseId,
          requestId,
        });

      if (!identity) {
        throw publicError(
          "Catalog operation not found.",
          {
            status: 404,
            code: "CATALOG_OPERATION_NOT_FOUND",
          },
        );
      }

      if (
        identity.type === "TAKEDOWN" &&
        nextStatus === "COMPLETED"
      ) {
        await claimHighImpactMutation({
          request,
          shop: session.shop,
          operation: "complete-release-takedown",
          entityType:
            "RELEASE_LIFECYCLE_REQUEST",
          entityId: identity.id,
          confirmation: String(
            formData.get("safetyConfirmation") || "",
          ),
          expectedConfirmation:
            "COMPLETE TAKEDOWN",
        });
      }

      const updated =
        await transitionCatalogLifecycleRequest({
          shop: session.shop,
          releaseId,
          requestId,
          nextStatus,
          resolutionNote:
            formData.get("resolutionNote"),
          actorLabel: "Shopify admin",
        });

      return Response.json({
        ok: true,
        message: `${updated.type === "TAKEDOWN" ? "Takedown" : updated.type === "UPDATE" ? "Update" : "Correction"} request marked ${updated.status.toLowerCase().replaceAll("_", " ")}.`,
      });
    }

    return Response.json(
      {
        ok: false,
        error:
          "Unknown catalog-operations action.",
      },
      { status: 400 },
    );
  } catch (error) {
    return apiErrorResponse(
      request,
      error,
      {
        context: "catalog operations",
        operation: issueIntent,
        releaseId: params.releaseId,
        fallback:
          "ReleaseCore could not update catalog operations.",
        shop: issueShop,
      },
    );
  }
};
