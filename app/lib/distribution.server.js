import db from "../db.server";
import { assignCatalogNumberToRelease } from "./catalog.server";
import { generateReleaseMp3Previews } from "./audio-preview.server";
import { dispatchLatestEvent, dispatchReleaseEvent } from "./automations.server";
import { publicError, safeDiagnosticText } from "./http-security.server";
import { isrcAssignmentMode } from "./isrc";
import { assignManualIsrcToTrack } from "./isrc.server";
import {
  createTrackProduct,
  ensureReleaseCoreProductMetafields,
  syncProductMetafieldSafely,
  syncTrackProduct,
} from "./shopify-products.server";
import { findShopRelease } from "./tenant-db.server";
import { isValidUpc } from "./upc";
import { assignUpcToRelease } from "./upc.server";
import { DISTRIBUTION_STATUSES } from "./workflow";

const DISTRIBUTION_ACTION_INCLUDE = {
  artists: { include: { artist: true }, orderBy: { position: "asc" } },
  files: { orderBy: { createdAt: "desc" } },
  tracks: {
    orderBy: { position: "asc" },
    include: {
      artists: { include: { artist: true }, orderBy: { position: "asc" } },
      credits: {
        include: { contributor: true },
        orderBy: { createdAt: "asc" },
      },
      files: true,
    },
  },
};

export function getDistributionRelease(shop, releaseId) {
  return findShopRelease(shop, releaseId, {
    include: DISTRIBUTION_ACTION_INCLUDE,
  });
}

async function dispatchEventSafely({ admin, shop, eventId }) {
  try {
    await dispatchReleaseEvent({ admin, shop, eventId });
  } catch (error) {
    console.warn("ReleaseCore automation dispatch skipped", {
      message: safeDiagnosticText(error?.message || error),
    });
  }
}

async function recordEvent({
  releaseId,
  type,
  message,
  admin,
  shop,
  fromStatus = null,
  toStatus = null,
  trackId = null,
}) {
  const event = await db.submissionEvent.create({
    data: {
      releaseId,
      type,
      message,
      actorLabel: "Shopify admin",
      fromStatus,
      toStatus,
      trackId,
    },
  });
  await dispatchEventSafely({ admin, shop, eventId: event.id });
  return event;
}

async function recordMutationAndEvent({
  releaseId,
  releaseData,
  type,
  message,
  fromStatus = null,
  toStatus = null,
  trackId = null,
}) {
  return db.$transaction(async (tx) => {
    await tx.release.update({ where: { id: releaseId }, data: releaseData });
    return tx.submissionEvent.create({
      data: {
        releaseId,
        type,
        message,
        actorLabel: "Shopify admin",
        fromStatus,
        toStatus,
        trackId,
      },
    });
  });
}

async function repairAndSyncExistingProducts({ admin, release, settings }) {
  let synced = 0;
  let stale = 0;
  for (const track of release.tracks) {
    if (!track.shopifyProductId) continue;
    const product = await syncTrackProduct({
      admin,
      productId: track.shopifyProductId,
      release,
      track,
      settings,
      price: undefined,
    });
    if (!product) {
      stale += 1;
      await db.track.update({
        where: { id: track.id },
        data: { shopifyProductId: null, shopifyProductHandle: null },
      });
      continue;
    }
    synced += 1;
    if (product.handle && product.handle !== track.shopifyProductHandle) {
      await db.track.update({
        where: { id: track.id },
        data: { shopifyProductHandle: product.handle },
      });
    }
  }
  return { synced, stale };
}

function requireDistributionRelease(release) {
  if (!release) throw publicError("Release not found.", { status: 404 });
  if (
    !["APPROVED", "CHANGES_REQUESTED"].includes(release.status) &&
    release.distributionStatus === "NOT_QUEUED"
  ) {
    throw publicError("This release has not been approved for distribution.", {
      status: 409,
    });
  }
}

export async function performDistributionAction({
  admin,
  shop,
  releaseId,
  formData,
}) {
  let release = await getDistributionRelease(shop, releaseId);
  requireDistributionRelease(release);

  const intent = String(formData.get("intent") || "");
  const settings = await db.appSettings.findUnique({ where: { shop } });

  if (
    release.status === "APPROVED" &&
    release.distributionStatus === "NOT_QUEUED"
  ) {
    await db.release.update({
      where: { id: release.id },
      data: { distributionStatus: "QUEUED", distributionUpdatedAt: new Date() },
    });
    release.distributionStatus = "QUEUED";
  }

  if (intent === "assign-upc") {
    const upc = await assignUpcToRelease({ releaseId: release.id, shop });
    release = await getDistributionRelease(shop, release.id);
    await ensureReleaseCoreProductMetafields(admin);
    await syncProductMetafieldSafely(
      admin,
      release.tracks.map((track) => track.shopifyProductId),
      "upc",
      "single_line_text_field",
      upc,
    );
    await repairAndSyncExistingProducts({ admin, release, settings });
    return { message: `UPC ${upc} assigned and synced to Shopify.` };
  }

  if (intent === "save-manual-upc") {
    const upc = String(formData.get("upc") || "").replace(/\D/g, "");
    if (!isValidUpc(upc)) {
      throw publicError(
        "Enter a valid 12-digit UPC / GTIN-12 with a correct check digit.",
        { status: 400 },
      );
    }
    const duplicate = await db.release.findFirst({
      where: { shop, upc, id: { not: release.id } },
    });
    if (duplicate) {
      throw publicError(
        "That UPC is already assigned to another ReleaseCore release.",
        { status: 409 },
      );
    }
    const event = await recordMutationAndEvent({
      releaseId: release.id,
      releaseData: { upc, upcAssignedAt: new Date() },
      type: "UPC_ENTERED",
      message: `UPC ${upc} entered by admin.`,
    });
    await dispatchEventSafely({ admin, shop, eventId: event.id });
    release = await getDistributionRelease(shop, release.id);
    await ensureReleaseCoreProductMetafields(admin);
    await syncProductMetafieldSafely(
      admin,
      release.tracks.map((track) => track.shopifyProductId),
      "upc",
      "single_line_text_field",
      upc,
    );
    await repairAndSyncExistingProducts({ admin, release, settings });
    return { message: `UPC ${upc} saved and synced to Shopify.` };
  }

  if (intent === "assign-catalog") {
    const catalogNumber = await assignCatalogNumberToRelease({
      releaseId: release.id,
      shop,
    });
    release = await getDistributionRelease(shop, release.id);
    await ensureReleaseCoreProductMetafields(admin);
    await syncProductMetafieldSafely(
      admin,
      release.tracks.map((track) => track.shopifyProductId),
      "catalog_number",
      "single_line_text_field",
      catalogNumber,
    );
    await repairAndSyncExistingProducts({ admin, release, settings });
    return {
      message: `Catalog number ${catalogNumber} assigned and synced to Shopify.`,
    };
  }

  if (intent === "save-manual-catalog") {
    const catalogNumber = String(formData.get("catalogNumber") || "")
      .trim()
      .toUpperCase();
    if (
      !catalogNumber ||
      catalogNumber.length > 32 ||
      !/^[A-Z0-9][A-Z0-9._-]*$/.test(catalogNumber)
    ) {
      throw publicError(
        "Enter a catalog number using letters, numbers, periods, underscores or hyphens (maximum 32 characters).",
        { status: 400 },
      );
    }
    const duplicate = await db.release.findFirst({
      where: { shop, catalogNumber, id: { not: release.id } },
    });
    if (duplicate) {
      throw publicError(
        "That catalog number is already assigned to another release in this store.",
        { status: 409 },
      );
    }
    const event = await recordMutationAndEvent({
      releaseId: release.id,
      releaseData: { catalogNumber, catalogNumberAssignedAt: new Date() },
      type: "CATALOG_NUMBER_ENTERED",
      message: `Catalog number ${catalogNumber} entered by admin.`,
    });
    await dispatchEventSafely({ admin, shop, eventId: event.id });
    release = await getDistributionRelease(shop, release.id);
    await ensureReleaseCoreProductMetafields(admin);
    await syncProductMetafieldSafely(
      admin,
      release.tracks.map((track) => track.shopifyProductId),
      "catalog_number",
      "single_line_text_field",
      catalogNumber,
    );
    await repairAndSyncExistingProducts({ admin, release, settings });
    return {
      message: `Catalog number ${catalogNumber} saved and synced to Shopify.`,
    };
  }

  if (intent === "save-manual-isrc") {
    if (isrcAssignmentMode(settings) !== "ADMIN") {
      throw publicError(
        "Switch ISRC assignment to Aggregator / admin provides ISRCs in Settings before entering codes manually.",
        { status: 409 },
      );
    }
    const trackId = String(formData.get("trackId") || "").trim();
    const track = release.tracks.find((item) => item.id === trackId);
    if (!track) {
      throw publicError("Selected track is not part of this release.", {
        status: 400,
      });
    }
    const result = await assignManualIsrcToTrack({
      trackId,
      shop,
      value: formData.get("isrc"),
    });
    let syncWarning = "";
    if (track.shopifyProductId) {
      try {
        await ensureReleaseCoreProductMetafields(admin);
        await syncProductMetafieldSafely(
          admin,
          [track.shopifyProductId],
          "isrc",
          "single_line_text_field",
          result.code,
        );
      } catch (error) {
        console.warn(
          "ReleaseCore: manual ISRC saved but Shopify sync was deferred",
          { message: safeDiagnosticText(error?.message || error) },
        );
        syncWarning =
          " The code is saved; use Shopify product sync to retry its metafield update.";
      }
    }
    if (result.assigned) {
      try {
        await dispatchLatestEvent({
          admin,
          shop,
          releaseId: release.id,
          type: "ISRC_ASSIGNED",
        });
      } catch (error) {
        console.warn("ReleaseCore automation dispatch skipped", {
          message: safeDiagnosticText(error?.message || error),
        });
      }
    }
    return {
      message:
        track.shopifyProductId && !syncWarning
          ? `ISRC ${result.code} assigned and synced to its Shopify product.`
          : track.shopifyProductId
            ? `ISRC ${result.code} assigned.${syncWarning}`
            : `ISRC ${result.code} assigned. It will sync when the Shopify product is created.`,
    };
  }

  if (intent === "update-distribution") {
    const nextStatus = String(
      formData.get("distributionStatus") || release.distributionStatus,
    ).toUpperCase();
    if (
      !DISTRIBUTION_STATUSES.includes(nextStatus) ||
      nextStatus === "NOT_QUEUED"
    ) {
      throw publicError("Choose a valid distribution status.", { status: 400 });
    }
    const aggregatorReference =
      String(formData.get("aggregatorReference") || "").trim() || null;
    const distributionNotes =
      String(formData.get("distributionNotes") || "").trim() || null;
    const event = await recordMutationAndEvent({
      releaseId: release.id,
      releaseData: {
        distributionStatus: nextStatus,
        distributionUpdatedAt: new Date(),
        aggregatorReference,
        distributionNotes,
      },
      type: `DISTRIBUTION_${nextStatus}`,
      message: `Distribution status changed to ${nextStatus.replaceAll("_", " ").toLowerCase()}.`,
    });
    await dispatchEventSafely({ admin, shop, eventId: event.id });
    await syncProductMetafieldSafely(
      admin,
      release.tracks.map((track) => track.shopifyProductId),
      "distribution_status",
      "single_line_text_field",
      nextStatus,
    );
    return { message: "Distribution status updated." };
  }

  if (intent === "return-for-corrections") {
    const message = String(formData.get("message") || "").trim();
    const trackId = String(formData.get("trackId") || "").trim() || null;
    if (!message) {
      throw publicError("Describe the correction that is required.", {
        status: 400,
      });
    }
    if (trackId && !release.tracks.some((track) => track.id === trackId)) {
      throw publicError("Selected track is not part of this release.", {
        status: 400,
      });
    }
    await db.$transaction([
      db.release.update({
        where: { id: release.id },
        data: {
          status: "CHANGES_REQUESTED",
          distributionStatus: "RETURNED_FOR_CORRECTIONS",
          distributionUpdatedAt: new Date(),
          decisionAt: null,
        },
      }),
      db.releaseReviewItem.create({
        data: { releaseId: release.id, trackId, message, status: "OPEN" },
      }),
      db.submissionEvent.create({
        data: {
          releaseId: release.id,
          trackId,
          type: "DISTRIBUTION_CORRECTION_REQUESTED",
          message,
          actorLabel: "Shopify admin",
          fromStatus: release.status,
          toStatus: "CHANGES_REQUESTED",
        },
      }),
    ]);
    await dispatchLatestEvent({
      admin,
      shop,
      releaseId: release.id,
      type: "DISTRIBUTION_CORRECTION_REQUESTED",
    });
    await syncProductMetafieldSafely(
      admin,
      release.tracks.map((track) => track.shopifyProductId),
      "distribution_status",
      "single_line_text_field",
      "RETURNED_FOR_CORRECTIONS",
    );
    return { message: "Release returned for corrections." };
  }

  if (intent === "generate-audio-previews") {
    if (!settings?.generateShopifyAudioPreview) {
      throw publicError("Enable Shopify MP3 previews in Settings first.", {
        status: 409,
      });
    }
    const result = await generateReleaseMp3Previews({
      admin,
      shop,
      releaseId: release.id,
      settings,
    });
    await ensureReleaseCoreProductMetafields(admin);
    const currentRelease = await getDistributionRelease(shop, release.id);
    await repairAndSyncExistingProducts({
      admin,
      release: currentRelease,
      settings,
    });
    await recordEvent({
      releaseId: release.id,
      type: "AUDIO_PREVIEWS_GENERATED",
      message: `${result.generated} MP3 preview${result.generated === 1 ? "" : "s"} generated${result.errors.length ? `; ${result.errors.length} track${result.errors.length === 1 ? "" : "s"} could not be converted` : ""}.`,
      admin,
      shop,
    });
    if (!result.generated && result.errors.length) {
      throw publicError(result.errors.join(" "), { status: 400 });
    }
    return {
      message: `${result.generated} MP3 preview${result.generated === 1 ? "" : "s"} generated and synced to Shopify.${result.errors.length ? ` ${result.errors.join(" ")}` : ""}`,
    };
  }

  if (intent === "create-shopify-products") {
    const price = Number(
      formData.get("price") || settings?.defaultTrackPrice || 1.29,
    );
    if (!Number.isFinite(price) || price < 0 || price > 9999) {
      throw publicError("Enter a valid Shopify price.", { status: 400 });
    }

    if (!release.catalogNumber) {
      if (
        (settings?.catalogMode || "AUTO") === "AUTO" &&
        settings?.autoAssignCatalogNumber !== false
      ) {
        await assignCatalogNumberToRelease({ releaseId: release.id, shop });
      } else {
        throw publicError(
          "Assign a catalog number before creating Shopify products. It is used for the product SKU.",
          { status: 409 },
        );
      }
    }

    const definitionResult = await ensureReleaseCoreProductMetafields(admin);
    if (definitionResult.mismatched.length) {
      throw publicError(
        `Shopify has ${definitionResult.mismatched.length} ReleaseCore metafield definition${definitionResult.mismatched.length === 1 ? "" : "s"} with an incompatible type. Open Settings → Shopify integration for details.`,
        { status: 409 },
      );
    }

    const currentRelease = await getDistributionRelease(shop, release.id);
    let created = 0;
    let updated = 0;
    let repaired = 0;
    for (const track of currentRelease.tracks) {
      if (track.shopifyProductId) {
        const product = await syncTrackProduct({
          admin,
          productId: track.shopifyProductId,
          release: currentRelease,
          track,
          settings,
          price,
        });
        if (product) {
          await db.track.update({
            where: { id: track.id },
            data: {
              shopifyProductHandle:
                product.handle || track.shopifyProductHandle,
            },
          });
          updated += 1;
          continue;
        }
        await db.track.update({
          where: { id: track.id },
          data: { shopifyProductId: null, shopifyProductHandle: null },
        });
        repaired += 1;
      }
      const product = await createTrackProduct({
        admin,
        release: currentRelease,
        track,
        settings,
        price,
      });
      await db.track.update({
        where: { id: track.id },
        data: {
          shopifyProductId: product.id,
          shopifyProductHandle: product.handle,
        },
      });
      created += 1;
    }
    await recordEvent({
      releaseId: release.id,
      type: "SHOPIFY_PRODUCTS_SYNCED",
      message: `${created} Shopify product${created === 1 ? "" : "s"} created, ${updated} updated${repaired ? `, and ${repaired} stale link${repaired === 1 ? "" : "s"} repaired` : ""}.`,
      admin,
      shop,
    });
    return {
      message: `${created} created · ${updated} synced${repaired ? ` · ${repaired} stale Shopify link${repaired === 1 ? "" : "s"} repaired` : ""}.`,
    };
  }

  throw publicError("Unknown distribution action.", { status: 400 });
}
