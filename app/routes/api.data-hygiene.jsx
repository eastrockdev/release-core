import { authenticate } from "../shopify.server";
import {
  deleteUnusedArtist,
  deleteUnusedContributor,
  linkArtistContributorIdentity,
  mergeArtistIntoArtist,
  mergeContributorIntoContributor,
  repairArtistNameCaches,
} from "../lib/data-hygiene.server";
import { apiErrorResponse } from "../lib/http-security.server";
import { claimHighImpactMutation } from "../lib/production-safety.server";

const asBool = (value) => String(value || "") === "true";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    const data = await request.formData();
    const intent = String(data.get("intent") || "");
    const shop = session.shop;

    if (intent === "merge-artist") {
      const sourceId = String(data.get("sourceId") || "");
      await claimHighImpactMutation({
        request,
        shop,
        operation: intent,
        entityType: "ARTIST",
        entityId: sourceId,
        confirmation: String(data.get("safetyConfirmation") || ""),
        expectedConfirmation: "MERGE ARTIST",
      });
      const result = await mergeArtistIntoArtist({
        shop,
        sourceId,
        targetId: String(data.get("targetId") || ""),
        collectionResolution: String(data.get("collectionResolution") || ""),
        confirmed: asBool(data.get("confirmed")),
      });
      return Response.json({ ok: true, ...result });
    }

    if (intent === "merge-contributor") {
      const contributorSourceId = String(data.get("sourceId") || "");
      await claimHighImpactMutation({
        request,
        shop,
        operation: intent,
        entityType: "CONTRIBUTOR",
        entityId: contributorSourceId,
        confirmation: String(data.get("safetyConfirmation") || ""),
        expectedConfirmation: "MERGE CONTRIBUTOR",
      });
      const resolutions = {};
      const customValues = {};
      for (const [key, value] of data.entries()) {
        if (key.startsWith("resolution:")) resolutions[key.slice("resolution:".length)] = String(value);
        if (key.startsWith("custom:")) customValues[key.slice("custom:".length)] = String(value);
      }
      const result = await mergeContributorIntoContributor({
        shop,
        sourceId: contributorSourceId,
        targetId: String(data.get("targetId") || ""),
        resolutions,
        customValues,
        ownerCustomerResolution: String(
          data.get("ownerCustomerResolution") || "",
        ),
        confirmed: asBool(data.get("confirmed")),
      });
      return Response.json({ ok: true, ...result });
    }

    if (intent === "link-same-person") {
      const result = await linkArtistContributorIdentity({
        shop,
        artistId: String(data.get("artistId") || ""),
        contributorId: String(data.get("contributorId") || ""),
      });
      return Response.json({ ok: true, ...result });
    }

    if (intent === "delete-unused-artist") {
      const artistId = String(data.get("artistId") || "");
      await claimHighImpactMutation({
        request,
        shop,
        operation: intent,
        entityType: "ARTIST",
        entityId: artistId,
        confirmation: String(data.get("safetyConfirmation") || ""),
        expectedConfirmation: "DELETE ARTIST",
      });
      const result = await deleteUnusedArtist({ shop, artistId });
      return Response.json({ ok: true, ...result });
    }

    if (intent === "delete-unused-contributor") {
      const contributorId = String(data.get("contributorId") || "");
      await claimHighImpactMutation({
        request,
        shop,
        operation: intent,
        entityType: "CONTRIBUTOR",
        entityId: contributorId,
        confirmation: String(data.get("safetyConfirmation") || ""),
        expectedConfirmation: "DELETE CONTRIBUTOR",
      });
      const result = await deleteUnusedContributor({ shop, contributorId });
      return Response.json({ ok: true, ...result });
    }

    if (intent === "repair-artist-cache") {
      const result = await repairArtistNameCaches({ shop });
      return Response.json({ ok: true, ...result });
    }

    return Response.json({ ok: false, error: "Unknown data-maintenance action." }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(request, error, {
      context: "data maintenance",
      fallback: "ReleaseCore could not complete this maintenance action.",
      operation: "data-maintenance",
    });
  }
};
