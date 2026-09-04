import { authenticate } from "../shopify.server";
import {
  createCatalogRelationship,
  deleteCatalogRelationship,
  deleteTrackRecordingRelationship,
  setTrackRecordingRelationship,
  updateCatalogRelationship,
} from "../lib/catalog-relationships.server";
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
    const intent = String(
      formData.get("intent") || "",
    );
    const releaseId = String(
      params.releaseId || "",
    );

    if (intent === "add-relationship") {
      const relationship =
        await createCatalogRelationship({
          shop: session.shop,
          releaseId,
          relatedReleaseId: String(
            formData.get("relatedReleaseId") ||
              "",
          ),
          relationshipType: String(
            formData.get("relationshipType") ||
              "",
          ),
          notes: String(
            formData.get("notes") || "",
          ),
        });

      return Response.json({
        ok: true,
        relationship,
        message:
          relationship.seededTracks > 0
            ? `Catalog relationship added. ${relationship.seededTracks} track mapping${relationship.seededTracks === 1 ? "" : "s"} seeded for review.`
            : "Catalog relationship added.",
      });
    }

    if (intent === "update-relationship") {
      await updateCatalogRelationship({
        shop: session.shop,
        releaseId,
        relationshipId: String(
          formData.get("relationshipId") ||
            "",
        ),
        relationshipType: String(
          formData.get("relationshipType") ||
            "",
        ),
        notes: String(
          formData.get("notes") || "",
        ),
      });

      return Response.json({
        ok: true,
        message:
          "Catalog relationship updated.",
      });
    }

    if (intent === "remove-relationship") {
      await deleteCatalogRelationship({
        shop: session.shop,
        releaseId,
        relationshipId: String(
          formData.get("relationshipId") ||
            "",
        ),
      });

      return Response.json({
        ok: true,
        message:
          "Catalog relationship removed.",
      });
    }

    if (intent === "set-track-lineage") {
      await setTrackRecordingRelationship({
        shop: session.shop,
        releaseId,
        releaseRelationshipId: String(
          formData.get(
            "releaseRelationshipId",
          ) || "",
        ),
        trackId: String(
          formData.get("trackId") || "",
        ),
        relatedTrackId: String(
          formData.get("relatedTrackId") ||
            "",
        ),
        recordingRelationship: String(
          formData.get(
            "recordingRelationship",
          ) || "",
        ),
        notes: String(
          formData.get("notes") || "",
        ),
      });

      return Response.json({
        ok: true,
        message:
          "Recording lineage saved.",
      });
    }

    if (
      intent === "remove-track-lineage"
    ) {
      await deleteTrackRecordingRelationship({
        shop: session.shop,
        releaseId,
        releaseRelationshipId: String(
          formData.get(
            "releaseRelationshipId",
          ) || "",
        ),
        trackId: String(
          formData.get("trackId") || "",
        ),
      });

      return Response.json({
        ok: true,
        message:
          "Recording lineage removed.",
      });
    }

    return Response.json(
      {
        ok: false,
        error:
          "Unknown catalog relationship action.",
      },
      { status: 400 },
    );
  } catch (error) {
    return apiErrorResponse(
      request,
      error,
      {
        context:
          "catalog relationships",
        fallback:
          "ReleaseCore could not update catalog relationships.",
      },
    );
  }
};
