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
import { publishProductToOnlineStore, unpublishProductFromOnlineStore } from "./shopify-catalog.server";
import { SHOPIFY_FIXED_BUNDLE_COMPONENT_LIMIT, syncReleaseProduct } from "./shopify-bundles.server";
import { DISTRIBUTION_STATUSES } from "./workflow";
import {
  assertDistributionPreflight,
  recordDistributionSyncWarning,
  retryDistributionHealth,
  runDistributionPreflight,
} from "./distribution-health.server";
import { orchestrateReleasePublication } from "./publication-orchestration.server";

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

function linkedShopifyProductIds(release) {
  return [
    release?.shopifyReleaseProductId,
    ...(release?.tracks || []).map((track) => track.shopifyProductId),
  ].filter(Boolean);
}

async function persistReleaseBundleOperation(releaseId, operationId) {
  await db.release.update({
    where: { id: releaseId },
    data: { shopifyReleaseBundleOperationId: operationId || null },
  });
}

async function persistReleaseShopifyProduct(releaseId, product) {
  await db.release.update({
    where: { id: releaseId },
    data: {
      shopifyReleaseProductId: product?.id || null,
      shopifyReleaseProductHandle: product?.handle || null,
      shopifyReleaseBundleOperationId: null,
    },
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
      linkedShopifyProductIds(release),
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
      linkedShopifyProductIds(release),
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
      linkedShopifyProductIds(release),
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
      linkedShopifyProductIds(release),
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
        await recordDistributionSyncWarning({
          shop,
          releaseId: release.id,
          trackId: track.id,
          message: `ISRC ${result.code} was saved, but its Shopify product sync was deferred: ${safeDiagnosticText(error?.message || error, 700)}`,
        });
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

  if (intent === "retry-sync-health") {
    let trackIds = [];
    try {
      const parsed = JSON.parse(
        String(formData.get("trackIds") || "[]"),
      );
      if (!Array.isArray(parsed)) {
        throw new Error("Track IDs must be an array.");
      }
      trackIds = parsed.map((value) => String(value));
    } catch {
      throw publicError(
        "ReleaseCore could not read the failed-item retry list.",
        { status: 400 },
      );
    }

    const retryReleaseProduct =
      String(formData.get("retryReleaseProduct") || "") === "true";

    if (!trackIds.length && !retryReleaseProduct) {
      return { message: "No failed Shopify sync items need retrying." };
    }

    const currentRelease = await getDistributionRelease(
      shop,
      release.id,
    );
    const preflight = await runDistributionPreflight({
      admin,
      release: currentRelease,
      settings,
    });
    const mode =
      retryReleaseProduct && trackIds.length
        ? "ALL"
        : retryReleaseProduct
          ? "RELEASE"
          : "TRACKS";
    assertDistributionPreflight(preflight, mode);

    const result = await retryDistributionHealth({
      admin,
      shop,
      release: currentRelease,
      settings,
      trackIds,
      retryReleaseProduct,
    });

    const recovered = result.recovered.length;
    const remaining = result.failures.length;
    const pending = result.releaseProductPending
      ? " Shopify is still processing the Album/EP bundle."
      : "";
    const message =
      `${recovered} failed sync item${recovered === 1 ? "" : "s"} recovered.` +
      (remaining
        ? ` ${remaining} item${remaining === 1 ? "" : "s"} still need attention.`
        : "") +
      pending;

    return {
      message,
      ...(remaining
        ? {
            warning: result.failures
              .slice(0, 3)
              .map((item) => `${item.title}: ${item.message}`)
              .join(" "),
          }
        : {}),
    };
  }

  if (intent === "orchestrate-publication") {
    const result = await orchestrateReleasePublication({
      admin,
      release,
      mode: formData.get("mode"),
    });
    return {
      message: result.message,
      ...(result.warning
        ? { warning: result.warning }
        : {}),
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
      linkedShopifyProductIds(release),
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
      linkedShopifyProductIds(release),
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
    let productSyncWarning = "";
    try {
      await repairAndSyncExistingProducts({
        admin,
        release: currentRelease,
        settings,
      });
    } catch (error) {
      console.warn(
        "ReleaseCore: audio previews generated but Shopify product sync was deferred",
        { message: safeDiagnosticText(error?.message || error) },
      );
      productSyncWarning =
        " Audio previews were generated successfully, but Shopify product metadata could not be synced. Use Sync Shopify Products to retry.";
      await recordDistributionSyncWarning({
        shop,
        releaseId: release.id,
        message: `Audio previews were generated, but Shopify product sync was deferred: ${safeDiagnosticText(error?.message || error, 700)}`,
      });
    }
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
      message: productSyncWarning
        ? `${result.generated} MP3 preview${result.generated === 1 ? "" : "s"} generated.${productSyncWarning}${result.errors.length ? ` ${result.errors.join(" ")}` : ""}`
        : `${result.generated} MP3 preview${result.generated === 1 ? "" : "s"} generated and synced to Shopify.${result.errors.length ? ` ${result.errors.join(" ")}` : ""}`,
    };
  }

  if (["publish-shopify-release-product", "schedule-shopify-release-product", "unpublish-shopify-release-product"].includes(intent)) {
    if (!["ALBUM", "EP"].includes(String(release.type || "").toUpperCase())) {
      throw publicError("Only Album and EP releases have a release-level Shopify product.", { status: 409 });
    }
    if (!release.shopifyReleaseProductId) {
      throw publicError("Create the Shopify Album/EP product first.", { status: 409 });
    }
    if (intent === "unpublish-shopify-release-product") {
      await unpublishProductFromOnlineStore({ admin, productId: release.shopifyReleaseProductId });
      return { message: `${release.title} was unpublished from the Online Store.` };
    }
    if (intent === "schedule-shopify-release-product" && !release.releaseDate) {
      throw publicError("Set a release date before scheduling Online Store publication.", { status: 409 });
    }
    await publishProductToOnlineStore({
      admin,
      productId: release.shopifyReleaseProductId,
      publishDate: intent === "schedule-shopify-release-product" ? release.releaseDate : null,
    });
    return {
      message: intent === "schedule-shopify-release-product"
        ? `${release.title} is scheduled for the release date.`
        : `${release.title} is published to the Online Store.`,
    };
  }

  if (intent === "sync-shopify-release-product") {
    if (!["ALBUM", "EP"].includes(String(release.type || "").toUpperCase())) {
      throw publicError("Only Album and EP releases use a separate Shopify release product.", { status: 409 });
    }
    const price = Number(formData.get("price") || settings?.defaultAlbumPrice || 9.99);
    if (!Number.isFinite(price) || price < 0 || price > 9999) {
      throw publicError("Enter a valid Album/EP price.", { status: 400 });
    }
    const missingTracks = release.tracks.filter((track) => !track.shopifyProductId);
    if (missingTracks.length) {
      throw publicError(
        `Sync all ${release.tracks.length} track products before creating the Album/EP product. ${missingTracks.length} track product${missingTracks.length === 1 ? " is" : "s are"} still missing.`,
        { status: 409 },
      );
    }
    if (!release.catalogNumber) {
      throw publicError("Assign a catalog number before creating the Album/EP product.", { status: 409 });
    }

    const definitionResult = await ensureReleaseCoreProductMetafields(admin);
    if (definitionResult.mismatched.length) {
      throw publicError(
        `Shopify has ${definitionResult.mismatched.length} ReleaseCore metafield definition${definitionResult.mismatched.length === 1 ? "" : "s"} with an incompatible type. Open Settings → Shopify integration for details.`,
        { status: 409 },
      );
    }

    const currentRelease = await getDistributionRelease(shop, release.id);
    const preflight = await runDistributionPreflight({
      admin,
      release: currentRelease,
      settings,
    });
    assertDistributionPreflight(preflight, "RELEASE");
    try {
      const result = await syncReleaseProduct({
        admin,
        release: currentRelease,
        settings,
        price,
        onOperationStarted: (operationId) => persistReleaseBundleOperation(release.id, operationId),
        onOperationFinished: () => persistReleaseBundleOperation(release.id, null),
        onProductResolved: (product) => persistReleaseShopifyProduct(release.id, product),
        onProductCreated: (product) => persistReleaseShopifyProduct(release.id, product),
      });
      if (result.pending) {
        return { message: "Shopify is still building the fixed bundle. Run Sync Album/EP product again in a moment to finish the catalog sync." };
      }
      const product = result.product;
      if (product?.id) {
        await persistReleaseShopifyProduct(release.id, product);
      }

      let associationWarning = "";
      try {
        const refreshedRelease = await getDistributionRelease(
          shop,
          release.id,
        );
        await repairAndSyncExistingProducts({
          admin,
          release: refreshedRelease,
          settings,
        });
      } catch (error) {
        associationWarning =
          " The Album/EP product is synchronized, but track associated-album reference sync was deferred. Retry failed items from Sync health.";
        await recordDistributionSyncWarning({
          shop,
          releaseId: release.id,
          message: `Album/EP product synchronized, but associated album reference sync was deferred: ${safeDiagnosticText(error?.message || error, 700)}`,
        });
      }

      await recordEvent({
        releaseId: release.id,
        type: "SHOPIFY_RELEASE_PRODUCT_SYNCED",
        message: result.mode === "BUNDLE"
          ? `Shopify ${release.type === "EP" ? "EP" : "album"} fixed bundle synced with ${currentRelease.tracks.length} component${currentRelease.tracks.length === 1 ? "" : "s"}.`
          : `Shopify ${release.type === "EP" ? "EP" : "album"} product synced as a standard product because the release exceeds Shopify's ${SHOPIFY_FIXED_BUNDLE_COMPONENT_LIMIT}-component fixed bundle limit.`,
        admin,
        shop,
      });
      const base = result.mode === "BUNDLE"
        ? `${release.type === "EP" ? "EP" : "Album"} fixed bundle synced with ${currentRelease.tracks.length} track${currentRelease.tracks.length === 1 ? "" : "s"}.`
        : `${release.type === "EP" ? "EP" : "Album"} product synced as a standard product.`;
      const warnings = [
        result.warning,
        associationWarning,
      ]
        .filter(Boolean)
        .join(" ");
      return {
        message: warnings ? `${base} ${warnings}` : base,
        ...(associationWarning ? { warning: associationWarning.trim() } : {}),
      };
    } catch (error) {
      const message = String(error?.message || error);
      if (/bundles feature|not.*bundle|bundle.*not.*available|access to bundles/i.test(message)) {
        throw publicError("This Shopify store does not currently have access to fixed bundles. Confirm Bundles eligibility in Shopify, then retry.", { status: 409 });
      }
      throw error;
    }
  }

  if (["publish-shopify-product", "schedule-shopify-product", "unpublish-shopify-product"].includes(intent)) {
    const trackId = String(formData.get("trackId") || "").trim();
    const track = release.tracks.find((item) => item.id === trackId);
    if (!track?.shopifyProductId) throw publicError("Create the Shopify track product first.", { status: 409 });
    if (intent === "unpublish-shopify-product") {
      await unpublishProductFromOnlineStore({ admin, productId: track.shopifyProductId });
      return { message: `${track.title} was unpublished from the Online Store.` };
    }
    if (intent === "schedule-shopify-product" && !release.releaseDate) {
      throw publicError("Set a release date before scheduling Online Store publication.", { status: 409 });
    }
    await publishProductToOnlineStore({
      admin,
      productId: track.shopifyProductId,
      publishDate: intent === "schedule-shopify-product" ? release.releaseDate : null,
    });
    return {
      message: intent === "schedule-shopify-product"
        ? `${track.title} is scheduled for the release date.`
        : `${track.title} is published to the Online Store.`,
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
    const preflight = await runDistributionPreflight({
      admin,
      release: currentRelease,
      settings,
    });
    assertDistributionPreflight(preflight, "TRACKS");

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
        onCreated: async (createdProduct) => {
          await db.track.update({
            where: { id: track.id },
            data: {
              shopifyProductId: createdProduct.id,
              shopifyProductHandle: createdProduct.handle,
            },
          });
        },
      });
      if (product.handle) {
        await db.track.update({
          where: { id: track.id },
          data: { shopifyProductHandle: product.handle },
        });
      }
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
