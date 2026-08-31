import { authenticate } from "../shopify.server";
import db from "../db.server";
import { assignUpcToRelease } from "../lib/upc.server";
import { isValidUpc } from "../lib/upc";
import { assignCatalogNumberToRelease } from "../lib/catalog.server";
import { normalizeCatalogPrefix } from "../lib/catalog";
import {
  createTrackProduct,
  ensureReleaseCoreProductMetafields,
  syncProductMetafieldSafely,
  syncTrackProduct,
} from "../lib/shopify-products.server";
import { DISTRIBUTION_STATUSES } from "../lib/workflow";
import { dispatchLatestEvent, dispatchReleaseEvent } from "../lib/automations.server";
import { generateReleaseMp3Previews } from "../lib/audio-preview.server";

async function getRelease(id, shop) {
  return db.release.findFirst({
    where: { id, shop },
    include: {
      artists: { include: { artist: true }, orderBy: { position: "asc" } },
      files: { orderBy: { createdAt: "desc" } },
      tracks: {
        orderBy: { position: "asc" },
        include: {
          artists: { include: { artist: true }, orderBy: { position: "asc" } },
          credits: { include: { contributor: true }, orderBy: { createdAt: "asc" } },
          files: true,
        },
      },
    },
  });
}

async function recordEvent(releaseId, type, message, admin, shop) {
  const event = await db.submissionEvent.create({ data: { releaseId, type, message, actorLabel: "Shopify admin" } });
  try { await dispatchReleaseEvent({ admin, shop, eventId: event.id }); } catch (error) { console.warn("ReleaseCore automation dispatch skipped", error); }
  return event;
}

async function repairAndSyncExistingProducts(admin, release, settings) {
  let synced = 0;
  let stale = 0;
  for (const track of release.tracks) {
    if (!track.shopifyProductId) continue;
    const product = await syncTrackProduct({ admin, productId: track.shopifyProductId, release, track, settings, price: undefined });
    if (!product) {
      stale += 1;
      await db.track.update({ where: { id: track.id }, data: { shopifyProductId: null, shopifyProductHandle: null } });
      continue;
    }
    synced += 1;
    if (product.handle && product.handle !== track.shopifyProductHandle) {
      await db.track.update({ where: { id: track.id }, data: { shopifyProductHandle: product.handle } });
    }
  }
  return { synced, stale };
}

export const action = async ({ request, params }) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  try {
    const { admin, session } = await authenticate.admin(request);
    let release = await getRelease(params.releaseId, session.shop);
    if (!release) return Response.json({ ok: false, error: "Release not found." }, { status: 404 });
    if (!["APPROVED", "CHANGES_REQUESTED"].includes(release.status) && release.distributionStatus === "NOT_QUEUED") return Response.json({ ok: false, error: "This release has not been approved for distribution." }, { status: 409 });
    const formData = await request.formData();
    const intent = String(formData.get("intent") || "");
    const settings = await db.appSettings.findUnique({ where: { shop: session.shop } });
    if (release.status === "APPROVED" && release.distributionStatus === "NOT_QUEUED") {
      await db.release.update({ where: { id: release.id }, data: { distributionStatus: "QUEUED", distributionUpdatedAt: new Date() } });
      release.distributionStatus = "QUEUED";
    }

    if (intent === "assign-upc") {
      const upc = await assignUpcToRelease({ releaseId: release.id, shop: session.shop });
      release = await getRelease(release.id, session.shop);
      await ensureReleaseCoreProductMetafields(admin);
      await syncProductMetafieldSafely(admin, release.tracks.map((t) => t.shopifyProductId), "upc", "single_line_text_field", upc);
      await repairAndSyncExistingProducts(admin, release, settings);
      return Response.json({ ok: true, message: `UPC ${upc} assigned and synced to Shopify.` });
    }

    if (intent === "save-manual-upc") {
      const upc = String(formData.get("upc") || "").replace(/\D/g, "");
      if (!isValidUpc(upc)) return Response.json({ ok: false, error: "Enter a valid 12-digit UPC / GTIN-12 with a correct check digit." }, { status: 400 });
      const duplicate = await db.release.findFirst({ where: { shop: session.shop, upc, id: { not: release.id } } });
      if (duplicate) return Response.json({ ok: false, error: "That UPC is already assigned to another ReleaseCore release." }, { status: 409 });
      await db.release.update({ where: { id: release.id }, data: { upc, upcAssignedAt: new Date() } });
      await recordEvent(release.id, "UPC_ENTERED", `UPC ${upc} entered by admin.`, admin, session.shop);
      release = await getRelease(release.id, session.shop);
      await ensureReleaseCoreProductMetafields(admin);
      await syncProductMetafieldSafely(admin, release.tracks.map((t) => t.shopifyProductId), "upc", "single_line_text_field", upc);
      await repairAndSyncExistingProducts(admin, release, settings);
      return Response.json({ ok: true, message: `UPC ${upc} saved and synced to Shopify.` });
    }

    if (intent === "assign-catalog") {
      const catalogNumber = await assignCatalogNumberToRelease({ releaseId: release.id, shop: session.shop });
      release = await getRelease(release.id, session.shop);
      await ensureReleaseCoreProductMetafields(admin);
      await syncProductMetafieldSafely(admin, release.tracks.map((t) => t.shopifyProductId), "catalog_number", "single_line_text_field", catalogNumber);
      await repairAndSyncExistingProducts(admin, release, settings);
      return Response.json({ ok: true, message: `Catalog number ${catalogNumber} assigned and synced to Shopify.` });
    }

    if (intent === "save-manual-catalog") {
      const catalogNumber = String(formData.get("catalogNumber") || "").trim().toUpperCase();
      if (!catalogNumber || catalogNumber.length > 32 || !/^[A-Z0-9][A-Z0-9._-]*$/.test(catalogNumber)) return Response.json({ ok: false, error: "Enter a catalog number using letters, numbers, periods, underscores or hyphens (maximum 32 characters)." }, { status: 400 });
      const duplicate = await db.release.findFirst({ where: { shop: session.shop, catalogNumber, id: { not: release.id } } });
      if (duplicate) return Response.json({ ok: false, error: "That catalog number is already assigned to another release in this store." }, { status: 409 });
      await db.release.update({ where: { id: release.id }, data: { catalogNumber, catalogNumberAssignedAt: new Date() } });
      await recordEvent(release.id, "CATALOG_NUMBER_ENTERED", `Catalog number ${catalogNumber} entered by admin.`, admin, session.shop);
      release = await getRelease(release.id, session.shop);
      await ensureReleaseCoreProductMetafields(admin);
      await syncProductMetafieldSafely(admin, release.tracks.map((t) => t.shopifyProductId), "catalog_number", "single_line_text_field", catalogNumber);
      await repairAndSyncExistingProducts(admin, release, settings);
      return Response.json({ ok: true, message: `Catalog number ${catalogNumber} saved and synced to Shopify.` });
    }

    if (intent === "update-distribution") {
      const nextStatus = String(formData.get("distributionStatus") || release.distributionStatus).toUpperCase();
      if (!DISTRIBUTION_STATUSES.includes(nextStatus) || nextStatus === "NOT_QUEUED") return Response.json({ ok: false, error: "Choose a valid distribution status." }, { status: 400 });
      const aggregatorReference = String(formData.get("aggregatorReference") || "").trim() || null;
      const distributionNotes = String(formData.get("distributionNotes") || "").trim() || null;
      await db.release.update({ where: { id: release.id }, data: { distributionStatus: nextStatus, distributionUpdatedAt: new Date(), aggregatorReference, distributionNotes } });
      await recordEvent(release.id, `DISTRIBUTION_${nextStatus}`, `Distribution status changed to ${nextStatus.replaceAll("_", " ").toLowerCase()}.`, admin, session.shop);
      await syncProductMetafieldSafely(admin, release.tracks.map((t) => t.shopifyProductId), "distribution_status", "single_line_text_field", nextStatus);
      return Response.json({ ok: true, message: "Distribution status updated." });
    }

    if (intent === "return-for-corrections") {
      const message = String(formData.get("message") || "").trim();
      const trackId = String(formData.get("trackId") || "").trim() || null;
      if (!message) return Response.json({ ok: false, error: "Describe the correction that is required." }, { status: 400 });
      if (trackId && !release.tracks.some((t) => t.id === trackId)) return Response.json({ ok: false, error: "Selected track is not part of this release." }, { status: 400 });
      await db.$transaction([
        db.release.update({ where: { id: release.id }, data: { status: "CHANGES_REQUESTED", distributionStatus: "RETURNED_FOR_CORRECTIONS", distributionUpdatedAt: new Date(), decisionAt: null } }),
        db.releaseReviewItem.create({ data: { releaseId: release.id, trackId, message, status: "OPEN" } }),
        db.submissionEvent.create({ data: { releaseId: release.id, trackId, type: "DISTRIBUTION_CORRECTION_REQUESTED", message, actorLabel: "Shopify admin", fromStatus: release.status, toStatus: "CHANGES_REQUESTED" } }),
      ]);
      await dispatchLatestEvent({ admin, shop: session.shop, releaseId: release.id, type: "DISTRIBUTION_CORRECTION_REQUESTED" });
      await syncProductMetafieldSafely(admin, release.tracks.map((t) => t.shopifyProductId), "distribution_status", "single_line_text_field", "RETURNED_FOR_CORRECTIONS");
      return Response.json({ ok: true, message: "Release returned for corrections." });
    }

    if (intent === "generate-audio-previews") {
      if (!settings?.generateShopifyAudioPreview) return Response.json({ ok: false, error: "Enable Shopify MP3 previews in Settings first." }, { status: 409 });
      const result = await generateReleaseMp3Previews({ admin, shop: session.shop, releaseId: release.id, settings });
      await ensureReleaseCoreProductMetafields(admin);
      const currentRelease = await getRelease(release.id, session.shop);
      await repairAndSyncExistingProducts(admin, currentRelease, settings);
      await recordEvent(release.id, "AUDIO_PREVIEWS_GENERATED", `${result.generated} MP3 preview${result.generated === 1 ? "" : "s"} generated${result.errors.length ? `; ${result.errors.length} track${result.errors.length === 1 ? "" : "s"} could not be converted` : ""}.`, admin, session.shop);
      if (!result.generated && result.errors.length) return Response.json({ ok: false, error: result.errors.join(" ") }, { status: 400 });
      return Response.json({ ok: true, message: `${result.generated} MP3 preview${result.generated === 1 ? "" : "s"} generated and synced to Shopify.${result.errors.length ? ` ${result.errors.join(" ")}` : ""}` });
    }

    if (intent === "create-shopify-products") {
      const price = Number(formData.get("price") || settings?.defaultTrackPrice || 1.29);
      if (!Number.isFinite(price) || price < 0 || price > 9999) return Response.json({ ok: false, error: "Enter a valid Shopify price." }, { status: 400 });

      if (!release.catalogNumber) {
        if ((settings?.catalogMode || "AUTO") === "AUTO" && settings?.autoAssignCatalogNumber !== false) {
          await assignCatalogNumberToRelease({ releaseId: release.id, shop: session.shop });
        } else {
          return Response.json({ ok: false, error: "Assign a catalog number before creating Shopify products. It is used for the product SKU." }, { status: 409 });
        }
      }

      const definitionResult = await ensureReleaseCoreProductMetafields(admin);
      if (definitionResult.mismatched.length) {
        return Response.json({ ok: false, error: `Shopify has ${definitionResult.mismatched.length} ReleaseCore metafield definition${definitionResult.mismatched.length === 1 ? "" : "s"} with an incompatible type. Open Settings → Shopify integration for details.` }, { status: 409 });
      }

      const currentRelease = await getRelease(release.id, session.shop);
      let created = 0;
      let updated = 0;
      let repaired = 0;
      for (const track of currentRelease.tracks) {
        if (track.shopifyProductId) {
          const product = await syncTrackProduct({ admin, productId: track.shopifyProductId, release: currentRelease, track, settings, price });
          if (product) {
            await db.track.update({ where: { id: track.id }, data: { shopifyProductHandle: product.handle || track.shopifyProductHandle } });
            updated += 1;
            continue;
          }
          await db.track.update({ where: { id: track.id }, data: { shopifyProductId: null, shopifyProductHandle: null } });
          repaired += 1;
        }
        const product = await createTrackProduct({ admin, release: currentRelease, track, settings, price });
        await db.track.update({ where: { id: track.id }, data: { shopifyProductId: product.id, shopifyProductHandle: product.handle } });
        created += 1;
      }
      await recordEvent(release.id, "SHOPIFY_PRODUCTS_SYNCED", `${created} Shopify product${created === 1 ? "" : "s"} created, ${updated} updated${repaired ? `, and ${repaired} stale link${repaired === 1 ? "" : "s"} repaired` : ""}.`, admin, session.shop);
      return Response.json({ ok: true, message: `${created} created · ${updated} synced${repaired ? ` · ${repaired} stale Shopify link${repaired === 1 ? "" : "s"} repaired` : ""}.` });
    }

    return Response.json({ ok: false, error: "Unknown distribution action." }, { status: 400 });
  } catch (error) {
    console.error("ReleaseCore: distribution mutation failed", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "ReleaseCore could not update distribution." }, { status: 500 });
  }
};
