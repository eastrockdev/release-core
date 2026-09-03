import db from "../db.server";
import { safeDiagnosticText, publicError } from "./http-security.server";
import {
  buildEastRockTrackProductMetafields,
  eastRockCompatibilityEnabled,
} from "./east-rock-compatibility.server";
import {
  buildTrackProductMetafields,
  createTrackProduct,
  ensureReleaseCoreProductMetafields,
  getReleaseCoreMetafieldStatus,
  syncTrackProduct,
} from "./shopify-products.server";
import { getReleaseProductState } from "./shopify-catalog.server";
import {
  buildReleaseProductMetafields,
  SHOPIFY_FIXED_BUNDLE_COMPONENT_LIMIT,
  syncReleaseProduct,
} from "./shopify-bundles.server";

const SYNC_FAILURE_INTENTS = new Set([
  "create-shopify-products",
  "sync-shopify-release-product",
  "generate-audio-previews",
  "retry-sync-health",
  "orchestrate-publication",
]);

const CREDIT_LIST_KEYS = new Set([
  "songwriters",
  "composers",
  "producers",
  "recording_engineers",
  "mixing_engineers",
  "mastering_engineers",
  "cover_art_designers",
]);

function metafieldMap(items) {
  return new Map(
    (items || [])
      .filter((item) => item?.key)
      .map((item) => [String(item.key), item]),
  );
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizedMetafieldValue(field) {
  if (!field) return null;
  const type = String(field.type || "");
  const value = String(field.value ?? "");

  if (type === "json" || type.startsWith("list.")) {
    const parsed = parseJson(value);
    return parsed === null ? value : JSON.stringify(parsed);
  }

  if (type === "boolean") {
    return value.toLowerCase();
  }

  return value;
}

function fieldsMatch(expected, actual) {
  if (!expected || !actual) return false;
  return normalizedMetafieldValue(expected) === normalizedMetafieldValue(actual);
}

function comparableDesiredFields(fields) {
  return (fields || []).filter(
    (field) =>
      field?.namespace === "releasecore" &&
      field.key !== "audio_preview" &&
      !CREDIT_LIST_KEYS.has(field.key),
  );
}

function customComparableFields(fields) {
  return (fields || []).filter(
    (field) =>
      field?.namespace === "custom" &&
      field.key !== "audio_preview",
  );
}

function metadataDiff(expectedFields, actualFields) {
  const actual = metafieldMap(actualFields);
  return expectedFields
    .filter((field) => !fieldsMatch(field, actual.get(field.key)))
    .map((field) => field.key);
}

function previewFile(track) {
  return (track?.files || []).find(
    (file) =>
      file.kind === "PREVIEW_MP3" &&
      file.storageKey,
  ) || null;
}

function masterFile(track) {
  return (track?.files || []).find(
    (file) =>
      file.kind === "MASTER_WAV" &&
      file.storageKey,
  ) || null;
}

function publicationLabel(state, linked) {
  if (!linked) return "Not created";
  if (!state) return "Shopify link needs repair";
  if (state.status === "DRAFT") return "Draft";
  if (state.onlineStore?.scheduled) {
    const date = state.onlineStore.publishDate
      ? new Date(state.onlineStore.publishDate).toLocaleDateString()
      : "release date";
    return `Scheduled ${date}`;
  }
  if (state.onlineStore?.isPublished) return "Published";
  return state.status === "ACTIVE"
    ? "Active / unpublished"
    : state.status || "Connected";
}

function issue(code, message, {
  scope = "ALL",
  trackId = null,
  severity = "blocker",
} = {}) {
  return { code, message, scope, trackId, severity };
}

function parseChoices(validation) {
  if (!validation?.value) return [];
  const parsed = parseJson(validation.value);
  if (Array.isArray(parsed)) {
    return parsed.map((value) => String(value));
  }
  return [];
}

async function customChoiceDefinitions(admin) {
  const response = await admin.graphql(`#graphql
    query ReleaseCoreDistributionCustomChoiceDefinitions {
      metafieldDefinitions(
        first: 100,
        ownerType: PRODUCT,
        namespace: "custom"
      ) {
        nodes {
          key
          type { name }
          validations { name value }
        }
      }
    }
  `);

  const json = await response.json();
  const queryErrors = (json?.errors || [])
    .map((error) => String(error?.message || "").trim())
    .filter(Boolean);

  if (queryErrors.length) {
    throw new Error(queryErrors.join(" "));
  }

  const result = new Map();

  for (const definition of json?.data?.metafieldDefinitions?.nodes || []) {
    const validation = (definition.validations || []).find((item) =>
      /choices?/i.test(String(item?.name || "")),
    );
    const choices = parseChoices(validation);
    if (choices.length) {
      result.set(definition.key, {
        type: definition.type?.name || null,
        choices,
      });
    }
  }

  return result;
}

function valuesForChoiceField(field) {
  if (String(field?.type || "").startsWith("list.")) {
    const parsed = parseJson(field.value);
    return Array.isArray(parsed)
      ? parsed.map((value) => String(value))
      : [];
  }
  return [String(field?.value ?? "")];
}

function releasePrimaryArtist(release) {
  return (release?.artists || []).some(
    (assignment) => assignment.role === "PRIMARY" && assignment.artist?.name,
  );
}

function trackPrimaryArtist(track) {
  return (track?.artists || []).some(
    (assignment) => assignment.role === "PRIMARY" && assignment.artist?.name,
  );
}

export async function runDistributionPreflight({
  admin,
  release,
  settings,
}) {
  const blockers = [];
  const warnings = [];
  let definitionStatus = null;
  let customChoiceDefinitionCount = 0;

  if (!release?.catalogNumber) {
    blockers.push(
      issue(
        "CATALOG_NUMBER_MISSING",
        "Assign a catalog number before synchronizing Shopify products.",
        { scope: "ALL" },
      ),
    );
  }

  if (!(release?.tracks || []).length) {
    blockers.push(
      issue(
        "TRACKS_MISSING",
        "Add at least one track before synchronizing distribution.",
        { scope: "ALL" },
      ),
    );
  }

  if (
    ["ALBUM", "EP"].includes(String(release?.type || "").toUpperCase()) &&
    !releasePrimaryArtist(release)
  ) {
    warnings.push(
      issue(
        "RELEASE_PRIMARY_ARTIST_MISSING",
        "The Album/EP does not have a release-level primary artist assignment.",
        { scope: "RELEASE", severity: "warning" },
      ),
    );
  }

  if (!release?.upc) {
    warnings.push(
      issue(
        "UPC_PENDING",
        "UPC is still pending. Track products can sync, but the final release product should carry the release UPC.",
        { scope: "RELEASE", severity: "warning" },
      ),
    );
  }

  if (!release?.releaseDate) {
    warnings.push(
      issue(
        "RELEASE_DATE_MISSING",
        "Release date is missing, so scheduled Online Store publication cannot be used.",
        { scope: "ALL", severity: "warning" },
      ),
    );
  }

  for (const track of release?.tracks || []) {
    if (!String(track.title || "").trim() || track.title === "Untitled Track") {
      warnings.push(
        issue(
          "TRACK_TITLE_INCOMPLETE",
          `Track ${track.position} still has an incomplete title.`,
          { scope: "TRACKS", trackId: track.id, severity: "warning" },
        ),
      );
    }

    if (!trackPrimaryArtist(track)) {
      warnings.push(
        issue(
          "TRACK_PRIMARY_ARTIST_MISSING",
          `Track ${track.position} does not have a primary artist assignment.`,
          { scope: "TRACKS", trackId: track.id, severity: "warning" },
        ),
      );
    }

    if (settings?.requireIsrc !== false && !track.isrc) {
      warnings.push(
        issue(
          "TRACK_ISRC_MISSING",
          `Track ${track.position} is missing an ISRC.`,
          { scope: "TRACKS", trackId: track.id, severity: "warning" },
        ),
      );
    }

    if (settings?.requireTrackLanguage !== false && !track.language) {
      warnings.push(
        issue(
          "TRACK_LANGUAGE_MISSING",
          `Track ${track.position} is missing its language.`,
          { scope: "TRACKS", trackId: track.id, severity: "warning" },
        ),
      );
    }

    if (
      settings?.generateShopifyAudioPreview &&
      !previewFile(track) &&
      !masterFile(track)
    ) {
      warnings.push(
        issue(
          "PREVIEW_MASTER_MISSING",
          `Track ${track.position} cannot generate a preview until a master WAV is available.`,
          { scope: "TRACKS", trackId: track.id, severity: "warning" },
        ),
      );
    }
  }

  if (
    ["ALBUM", "EP"].includes(String(release?.type || "").toUpperCase())
  ) {
    const missingTrackProducts = (release.tracks || []).filter(
      (track) => !track.shopifyProductId,
    );
    if (missingTrackProducts.length) {
      blockers.push(
        issue(
          "BUNDLE_COMPONENTS_MISSING",
          `${missingTrackProducts.length} track product${missingTrackProducts.length === 1 ? " is" : "s are"} still missing before the Album/EP product can be synchronized.`,
          { scope: "RELEASE" },
        ),
      );
    }
  }

  try {
    definitionStatus = await getReleaseCoreMetafieldStatus(admin);
    for (const mismatch of definitionStatus.mismatched || []) {
      blockers.push(
        issue(
          "RELEASECORE_DEFINITION_MISMATCH",
          `Shopify metafield releasecore.${mismatch.key} is ${mismatch.actual}; ReleaseCore expects ${mismatch.expected}.`,
          { scope: "ALL" },
        ),
      );
    }

    if ((definitionStatus.missing || []).length) {
      warnings.push(
        issue(
          "RELEASECORE_DEFINITIONS_MISSING",
          `${definitionStatus.missing.length} ReleaseCore metafield definition${definitionStatus.missing.length === 1 ? " is" : "s are"} missing and will be installed automatically during sync.`,
          { scope: "ALL", severity: "warning" },
        ),
      );
    }

    if (
      (definitionStatus.hidden || []).length ||
      (definitionStatus.unconstrained || []).length
    ) {
      warnings.push(
        issue(
          "RELEASECORE_DEFINITIONS_REPAIRABLE",
          "Some ReleaseCore metafield definitions need access/category repair; synchronization will repair them automatically.",
          { scope: "ALL", severity: "warning" },
        ),
      );
    }
  } catch (error) {
    warnings.push(
      issue(
        "RELEASECORE_DEFINITION_CHECK_UNAVAILABLE",
        `ReleaseCore could not inspect Shopify metafield definitions during preflight: ${safeDiagnosticText(error?.message || error, 500)}`,
        { scope: "ALL", severity: "warning" },
      ),
    );
  }

  if (eastRockCompatibilityEnabled()) {
    try {
      const definitions = await customChoiceDefinitions(admin);
      customChoiceDefinitionCount = definitions.size;

      for (const track of release?.tracks || []) {
        const desired = buildEastRockTrackProductMetafields({
          release,
          track,
          settings,
        });

        for (const field of desired) {
          const definition = definitions.get(field.key);
          if (!definition?.choices?.length) continue;

          const invalid = valuesForChoiceField(field).filter(
            (value) => !definition.choices.includes(value),
          );

          if (invalid.length) {
            blockers.push(
              issue(
                "CUSTOM_CHOICE_INVALID",
                `Track ${track.position} would write ${field.namespace}.${field.key} value "${invalid[0]}", but Shopify only allows: ${definition.choices.join(", ")}.`,
                { scope: "TRACKS", trackId: track.id },
              ),
            );
          }
        }
      }
    } catch (error) {
      warnings.push(
        issue(
          "CUSTOM_CHOICE_CHECK_UNAVAILABLE",
          `ReleaseCore could not inspect East Rock choice-constrained metafields during preflight: ${safeDiagnosticText(error?.message || error, 500)}`,
          { scope: "TRACKS", severity: "warning" },
        ),
      );
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    ready: blockers.length === 0,
    blockers,
    warnings,
    definitionStatus,
    customChoiceDefinitionCount,
  };
}

export function blockersForPreflightMode(preflight, mode = "ALL") {
  const wanted = String(mode || "ALL").toUpperCase();
  return (preflight?.blockers || []).filter((item) => {
    if (item.scope === "ALL" || wanted === "ALL") return true;
    return item.scope === wanted;
  });
}

export function assertDistributionPreflight(preflight, mode = "ALL") {
  const blockers = blockersForPreflightMode(preflight, mode);
  if (!blockers.length) return;

  const message = blockers
    .slice(0, 3)
    .map((item) => item.message)
    .join(" ");

  const error = publicError(
    `Shopify sync preflight found ${blockers.length} blocker${blockers.length === 1 ? "" : "s"}. ${message}`,
    {
      status: 409,
      code: "SHOPIFY_SYNC_PREFLIGHT",
    },
  );
  error.blockers = blockers;
  throw error;
}

function expectedTrackFields(release, track, settings) {
  return buildTrackProductMetafields({
    release,
    track,
    settings,
  });
}

function trackHealth(release, track, settings) {
  const state = track.shopifyState || null;
  const preview = previewFile(track);

  const expected = expectedTrackFields(release, track, settings);
  const coreDiff = metadataDiff(
    comparableDesiredFields(expected),
    state?.metafields || [],
  );

  let customDiff = [];
  let customPreviewSynced = true;

  if (eastRockCompatibilityEnabled()) {
    const customExpected = buildEastRockTrackProductMetafields({
      release,
      track,
      settings,
    });
    customDiff = metadataDiff(
      customComparableFields(customExpected),
      state?.customMetafields || [],
    );

    const customPreview = customExpected.find(
      (field) => field.key === "audio_preview",
    );

    if (preview && customPreview) {
      customPreviewSynced = fieldsMatch(
        customPreview,
        metafieldMap(state?.customMetafields).get("audio_preview"),
      );
    }
  }

  const corePreview = expected.find(
    (field) =>
      field.namespace === "releasecore" &&
      field.key === "audio_preview",
  );

  const corePreviewSynced = preview
    ? Boolean(
        corePreview &&
        fieldsMatch(
          corePreview,
          metafieldMap(state?.metafields).get("audio_preview"),
        ),
      )
    : null;

  const previewSynced = preview
    ? Boolean(corePreviewSynced && customPreviewSynced)
    : null;

  const metadataSynced = Boolean(
    state &&
    coreDiff.length === 0 &&
    customDiff.length === 0,
  );

  const reasons = [];
  let status = "healthy";

  if (!track.shopifyProductId) {
    status = "pending";
    reasons.push("Shopify product has not been created yet.");
  } else if (!state) {
    status = "warning";
    reasons.push("The linked Shopify product could not be found.");
  } else {
    if (!metadataSynced) {
      status = "warning";
      reasons.push(
        `Metadata needs sync${[...coreDiff, ...customDiff].length ? ` (${[...coreDiff, ...customDiff].slice(0, 4).join(", ")})` : ""}.`,
      );
    }
    if (preview && !previewSynced) {
      status = "warning";
      reasons.push("Audio preview exists but its product metafield is not synchronized.");
    }
  }

  return {
    id: track.id,
    position: track.position,
    title: track.title,
    isrc: track.isrc || null,
    status,
    retry: status === "warning",
    reasons,
    product: {
      linked: Boolean(track.shopifyProductId),
      exists: Boolean(state),
      label: !track.shopifyProductId
        ? "Not created"
        : state
          ? "Connected"
          : "Stale link",
    },
    metadata: {
      synced: metadataSynced,
      label: !track.shopifyProductId
        ? "Pending"
        : metadataSynced
          ? "Synced"
          : "Needs sync",
      mismatchedKeys: [...new Set([...coreDiff, ...customDiff])],
    },
    preview: {
      generated: Boolean(preview),
      synced: previewSynced,
      label: !preview
        ? "Not generated"
        : previewSynced
          ? "Generated + synced"
          : "Generated · sync pending",
    },
    publication: publicationLabel(
      state,
      Boolean(track.shopifyProductId),
    ),
  };
}

function releaseProductHealth(release, settings) {
  if (
    !["ALBUM", "EP"].includes(
      String(release?.type || "").toUpperCase(),
    )
  ) {
    return null;
  }

  const state = release.shopifyReleaseState || null;
  const expected = buildReleaseProductMetafields({
    release,
    settings,
  });

  const diff = metadataDiff(
    comparableDesiredFields(expected),
    state?.metafields || [],
  );

  const desiredComponents = (release.tracks || [])
    .map((track) => track.shopifyProductId)
    .filter(Boolean);

  const componentIds = new Set(
    state?.componentProductIds || [],
  );

  const overLimit =
    (release.tracks || []).length >
    SHOPIFY_FIXED_BUNDLE_COMPONENT_LIMIT;

  const componentsSynced = overLimit
    ? true
    : Boolean(
        state?.isBundle &&
        desiredComponents.length === release.tracks.length &&
        desiredComponents.every((id) => componentIds.has(id)) &&
        componentIds.size === desiredComponents.length,
      );

  const metadataSynced = Boolean(state && diff.length === 0);
  const reasons = [];
  let status = "healthy";

  if (!release.shopifyReleaseProductId) {
    status = "pending";
    reasons.push("Album/EP product has not been created yet.");
  } else if (!state) {
    status = "warning";
    reasons.push("The linked Album/EP Shopify product could not be found.");
  } else {
    if (!metadataSynced) {
      status = "warning";
      reasons.push(
        `Release metadata needs sync${diff.length ? ` (${diff.slice(0, 4).join(", ")})` : ""}.`,
      );
    }
    if (!componentsSynced) {
      status = "warning";
      reasons.push("Bundle component relationships do not match the current tracklist.");
    }
  }

  return {
    status,
    retry:
      status === "warning" &&
      Boolean(
        release.shopifyReleaseProductId ||
        release.shopifyReleaseBundleOperationId,
      ),
    reasons,
    product: {
      linked: Boolean(release.shopifyReleaseProductId),
      exists: Boolean(state),
      label: !release.shopifyReleaseProductId
        ? release.shopifyReleaseBundleOperationId
          ? "Bundle processing"
          : "Not created"
        : state
          ? "Connected"
          : "Stale link",
    },
    metadata: {
      synced: metadataSynced,
      label: !release.shopifyReleaseProductId
        ? "Pending"
        : metadataSynced
          ? "Synced"
          : "Needs sync",
      mismatchedKeys: diff,
    },
    bundle: {
      applicable: !overLimit,
      synced: componentsSynced,
      label: overLimit
        ? "Standard product fallback"
        : !release.shopifyReleaseProductId
          ? "Pending"
          : componentsSynced
            ? `${desiredComponents.length}/${desiredComponents.length} components`
            : "Needs sync",
    },
    publication: publicationLabel(
      state,
      Boolean(release.shopifyReleaseProductId),
    ),
  };
}

function eventSummary(event) {
  if (!event) return null;
  return {
    id: event.id,
    type: event.type,
    message: event.message || null,
    createdAt: event.createdAt,
  };
}

export function buildDistributionHealth({
  release,
  settings,
  preflight,
}) {
  const tracks = (release?.tracks || []).map((track) =>
    trackHealth(release, track, settings),
  );
  const releaseProduct = releaseProductHealth(release, settings);

  const healthyTracks = tracks.filter(
    (track) => track.status === "healthy",
  ).length;
  const warningTracks = tracks.filter(
    (track) => track.status === "warning",
  ).length;
  const pendingTracks = tracks.filter(
    (track) => track.status === "pending",
  ).length;
  const previewReady = tracks.filter(
    (track) => track.preview.generated,
  ).length;
  const previewSynced = tracks.filter(
    (track) => track.preview.generated && track.preview.synced,
  ).length;

  const events = release?.events || [];
  const lastSuccessfulSync = events.find((event) =>
    [
      "SHOPIFY_PRODUCTS_SYNCED",
      "SHOPIFY_RELEASE_PRODUCT_SYNCED",
      "SHOPIFY_SYNC_RETRY_SUCCEEDED",
    ].includes(event.type),
  );
  const lastWarning = events.find((event) =>
    [
      "SHOPIFY_SYNC_WARNING",
      "SHOPIFY_PUBLICATION_WARNING",
    ].includes(event.type),
  );
  const lastError = events.find(
    (event) => event.type === "SHOPIFY_SYNC_FAILED",
  );

  return {
    checkedAt: new Date().toISOString(),
    preflight,
    summary: {
      healthyTracks,
      warningTracks,
      pendingTracks,
      linkedTracks: tracks.filter((track) => track.product.linked).length,
      previewReady,
      previewSynced,
    },
    tracks,
    releaseProduct,
    retry: {
      trackIds: tracks
        .filter((track) => track.retry)
        .map((track) => track.id),
      releaseProduct: Boolean(releaseProduct?.retry),
    },
    history: {
      lastSuccessfulSync: eventSummary(lastSuccessfulSync),
      lastWarning: eventSummary(lastWarning),
      lastError: eventSummary(lastError),
    },
  };
}

async function updateTrackLink(trackId, product) {
  await db.track.update({
    where: { id: trackId },
    data: {
      shopifyProductId: product?.id || null,
      shopifyProductHandle: product?.handle || null,
    },
  });
}

async function persistReleaseOperation(shop, releaseId, operationId) {
  await db.release.updateMany({
    where: { id: releaseId, shop },
    data: {
      shopifyReleaseBundleOperationId: operationId || null,
    },
  });
}

async function persistReleaseProduct(shop, releaseId, product) {
  await db.release.updateMany({
    where: { id: releaseId, shop },
    data: {
      shopifyReleaseProductId: product?.id || null,
      shopifyReleaseProductHandle: product?.handle || null,
      shopifyReleaseBundleOperationId: null,
    },
  });
}

export async function retryDistributionHealth({
  admin,
  shop,
  release,
  settings,
  trackIds = [],
  retryReleaseProduct = false,
}) {
  const requested = new Set(
    (trackIds || []).map((value) => String(value)),
  );

  const targets = (release?.tracks || []).filter(
    (track) => requested.has(track.id),
  );

  if (requested.size !== targets.length) {
    throw publicError(
      "One or more requested sync-health tracks do not belong to this release.",
      { status: 400 },
    );
  }

  await ensureReleaseCoreProductMetafields(admin);

  const recovered = [];
  const failures = [];

  for (const track of targets) {
    try {
      let product = null;

      if (track.shopifyProductId) {
        product = await syncTrackProduct({
          admin,
          productId: track.shopifyProductId,
          release,
          track,
          settings,
          price: undefined,
        });

        if (!product) {
          await updateTrackLink(track.id, null);
          track.shopifyProductId = null;
          track.shopifyProductHandle = null;
        }
      }

      if (!product) {
        product = await createTrackProduct({
          admin,
          release,
          track,
          settings,
          price: Number(settings?.defaultTrackPrice ?? 1.29),
          onCreated: (created) =>
            updateTrackLink(track.id, created),
        });
      }

      if (product?.id) {
        track.shopifyProductId = product.id;
        track.shopifyProductHandle =
          product.handle || track.shopifyProductHandle;
        await updateTrackLink(track.id, product);
      }

      recovered.push({
        scope: "track",
        id: track.id,
        title: track.title,
      });
    } catch (error) {
      failures.push({
        scope: "track",
        id: track.id,
        title: track.title,
        message: safeDiagnosticText(
          error?.message || error,
          700,
        ),
      });
    }
  }

  let releaseProductResult = null;

  if (retryReleaseProduct) {
    try {
      if (
        !["ALBUM", "EP"].includes(
          String(release?.type || "").toUpperCase(),
        )
      ) {
        throw new Error(
          "Only Album/EP releases have a release-level Shopify product.",
        );
      }

      if (
        (release.tracks || []).some(
          (track) => !track.shopifyProductId,
        )
      ) {
        throw new Error(
          "Every track product must be connected before the Album/EP product can be retried.",
        );
      }

      const currentState = release.shopifyReleaseProductId
        ? await getReleaseProductState(
            admin,
            release.shopifyReleaseProductId,
          )
        : null;
      const retryPrice = Number(
        currentState?.price ??
        settings?.defaultAlbumPrice ??
        9.99,
      );

      const result = await syncReleaseProduct({
        admin,
        release,
        settings,
        price: retryPrice,
        onOperationStarted: (operationId) =>
          persistReleaseOperation(
            shop,
            release.id,
            operationId,
          ),
        onOperationFinished: () =>
          persistReleaseOperation(
            shop,
            release.id,
            null,
          ),
        onProductResolved: (product) =>
          persistReleaseProduct(
            shop,
            release.id,
            product,
          ),
        onProductCreated: (product) =>
          persistReleaseProduct(
            shop,
            release.id,
            product,
          ),
      });

      if (result?.product?.id) {
        release.shopifyReleaseProductId =
          result.product.id;
        release.shopifyReleaseProductHandle =
          result.product.handle ||
          release.shopifyReleaseProductHandle;
        await persistReleaseProduct(
          shop,
          release.id,
          result.product,
        );
      }

      releaseProductResult = result;

      if (!result?.pending) {
        recovered.push({
          scope: "release",
          id: release.id,
          title: release.title,
        });
      }
    } catch (error) {
      failures.push({
        scope: "release",
        id: release.id,
        title: release.title,
        message: safeDiagnosticText(
          error?.message || error,
          700,
        ),
      });
    }
  }

  if (recovered.length) {
    await db.submissionEvent.create({
      data: {
        releaseId: release.id,
        type: "SHOPIFY_SYNC_RETRY_SUCCEEDED",
        message: `${recovered.length} failed Shopify sync item${recovered.length === 1 ? "" : "s"} recovered.`,
        actorLabel: "ReleaseCore sync health",
      },
    });
  }

  if (failures.length) {
    await db.submissionEvent.create({
      data: {
        releaseId: release.id,
        type: "SHOPIFY_SYNC_WARNING",
        message: `${failures.length} Shopify sync item${failures.length === 1 ? "" : "s"} still need attention: ${failures
          .slice(0, 3)
          .map((item) => `${item.title}: ${item.message}`)
          .join(" ")}`,
        actorLabel: "ReleaseCore sync health",
      },
    });
  }

  return {
    recovered,
    failures,
    releaseProductPending:
      Boolean(releaseProductResult?.pending),
  };
}

export async function recordDistributionFailure({
  shop,
  releaseId,
  intent,
  error,
}) {
  if (!SYNC_FAILURE_INTENTS.has(String(intent || ""))) {
    return false;
  }

  const release = await db.release.findFirst({
    where: { id: releaseId, shop },
    select: { id: true },
  });
  if (!release) return false;

  await db.submissionEvent.create({
    data: {
      releaseId: release.id,
      type: "SHOPIFY_SYNC_FAILED",
      message: `${String(intent || "Shopify sync")}: ${safeDiagnosticText(
        error?.message || error,
        1200,
      )}`,
      actorLabel: "ReleaseCore sync health",
    },
  });

  return true;
}

export async function recordDistributionSyncWarning({
  shop,
  releaseId,
  message,
  trackId = null,
}) {
  const release = await db.release.findFirst({
    where: { id: releaseId, shop },
    select: { id: true },
  });
  if (!release) return false;

  await db.submissionEvent.create({
    data: {
      releaseId: release.id,
      trackId,
      type: "SHOPIFY_SYNC_WARNING",
      message: safeDiagnosticText(message, 1200),
      actorLabel: "ReleaseCore sync health",
    },
  });

  return true;
}
