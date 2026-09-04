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
      const result = await mergeArtistIntoArtist({
        shop,
        sourceId: String(data.get("sourceId") || ""),
        targetId: String(data.get("targetId") || ""),
        collectionResolution: String(data.get("collectionResolution") || ""),
        confirmed: asBool(data.get("confirmed")),
      });
      return Response.json({ ok: true, ...result });
    }

    if (intent === "merge-contributor") {
      const resolutions = {};
      const customValues = {};
      for (const [key, value] of data.entries()) {
        if (key.startsWith("resolution:")) resolutions[key.slice("resolution:".length)] = String(value);
        if (key.startsWith("custom:")) customValues[key.slice("custom:".length)] = String(value);
      }
      const result = await mergeContributorIntoContributor({
        shop,
        sourceId: String(data.get("sourceId") || ""),
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
      const result = await deleteUnusedArtist({ shop, artistId: String(data.get("artistId") || "") });
      return Response.json({ ok: true, ...result });
    }

    if (intent === "delete-unused-contributor") {
      const result = await deleteUnusedContributor({ shop, contributorId: String(data.get("contributorId") || "") });
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
