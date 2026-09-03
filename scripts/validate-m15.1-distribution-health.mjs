import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const health = read(
  "app/lib/distribution-health.server.js",
);
const catalog = read("app/lib/shopify-catalog.server.js");
const workspace = read(
  "app/lib/distribution-workspace.server.js",
);
const distribution = read(
  "app/lib/distribution.server.js",
);
const api = read(
  "app/routes/api.distribution.$releaseId.jsx",
);
const admin = read(
  "app/routes/app.distribution_.$releaseId.jsx",
);
const releaseAdmin = read(
  "app/routes/app.release.$releaseId.jsx",
);
const trackInfo = read(
  "app/routes/app.release_.$releaseId.track.$trackId.jsx",
);
const bulkEditor = read(
  "app/routes/app.release_.$releaseId.tracks.bulk.jsx",
);
const bulkService = read(
  "app/lib/bulk-track-edit.server.js",
);
const compatibility = read(
  "app/lib/east-rock-compatibility.server.js",
);
const css = read("app/styles/releasecore-admin.css");

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(
  health,
  "runDistributionPreflight",
  "distribution preflight service is missing",
);
need(
  health,
  "CUSTOM_CHOICE_INVALID",
  "custom choice-field preflight is missing",
);
need(
  health,
  "getReleaseCoreMetafieldStatus",
  "ReleaseCore metafield definition preflight is missing",
);
need(
  health,
  "buildDistributionHealth",
  "sync health builder is missing",
);
need(
  health,
  "retryDistributionHealth",
  "targeted sync retry service is missing",
);
need(
  health,
  "SHOPIFY_SYNC_FAILED",
  "sync failure history is missing",
);
need(
  health,
  "SHOPIFY_SYNC_WARNING",
  "sync warning history is missing",
);
need(
  health,
  "SHOPIFY_SYNC_RETRY_SUCCEEDED",
  "sync retry success history is missing",
);

need(
  catalog,
  "releasecoreMetafields: metafields",
  "track/release product state does not read ReleaseCore metafields",
);
need(
  catalog,
  "customMetafields: metafields",
  "track product state does not read merchant custom metafields",
);
need(
  catalog,
  "metafields: product.releasecoreMetafields",
  "Shopify state does not expose ReleaseCore metafields to health checks",
);
need(
  catalog,
  "price:",
  "release product state does not expose current variant price for targeted retry",
);

need(
  workspace,
  "runDistributionPreflight",
  "distribution workspace does not run preflight",
);
need(
  workspace,
  "buildDistributionHealth",
  "distribution workspace does not expose sync health",
);
need(
  workspace,
  "syncHealth",
  "distribution workspace payload is missing sync health",
);

need(
  distribution,
  'intent === "retry-sync-health"',
  "distribution action does not support targeted retry",
);
need(
  distribution,
  'assertDistributionPreflight(preflight, "TRACKS")',
  "track product sync is not guarded by preflight",
);
need(
  distribution,
  'assertDistributionPreflight(preflight, "RELEASE")',
  "Album/EP sync is not guarded by preflight",
);
need(
  distribution,
  "recordDistributionSyncWarning",
  "non-fatal Shopify sync warnings are not persisted",
);
need(
  distribution,
  "associated album reference sync was deferred",
  "Album/EP parent sync does not independently retry track association metadata",
);

need(
  api,
  "recordDistributionFailure",
  "distribution API does not persist sync failures",
);
need(
  api,
  "shop,",
  "distribution errors still omit shop context",
);

need(
  admin,
  "Sync health",
  "Distribution Admin is missing Sync health UI",
);
need(
  admin,
  "Retry failed items",
  "Distribution Admin is missing targeted retry action",
);
need(
  admin,
  "Run preflight again",
  "Distribution Admin is missing preflight refresh action",
);
need(
  admin,
  '"retry-sync-health"',
  "Distribution Admin does not submit retry-sync-health",
);
need(
  admin,
  "lastSuccessfulSync",
  "Distribution Admin does not show sync history",
);
need(
  admin,
  "ISRC assignment and corrections are managed in Edit Track Info",
  "Distribution still describes the removed Track editor workflow.",
);
need(
  admin,
  `/app/release/${"${release.id}"}/track/${"${track.id}"}`,
  "Distribution does not open the affected track's Edit Track Info page.",
);
if (/name=["']isrc["']/.test(admin)) {
  failures.push(
    "Distribution still contains a named/editable ISRC input.",
  );
}

need(
  releaseAdmin,
  "function TrackListItem",
  "release workspace direct track navigation is missing",
);
if (releaseAdmin.includes("TrackEditorLaunch")) {
  failures.push(
    "release workspace still contains the old Track editor launch",
  );
}

need(
  trackInfo,
  'heading="Edit Track Info"',
  "individual Edit Track Info route is missing",
);
need(
  trackInfo,
  'name="isrc"',
  "Edit Track Info ISRC correction field is missing",
);
need(
  bulkEditor,
  'heading="Bulk Edit Tracks"',
  "multi-track Bulk Edit Tracks route is missing",
);

need(
  bulkService,
  "data: { position: -(index + 1) }",
  "track reordering is not atomic",
);
need(
  bulkService,
  "data.lyrics = row.lyrics",
  "lyrics persistence support is missing",
);
need(
  bulkService,
  "data: { isrc: null }",
  "ISRC correction swaps are not atomic",
);

need(
  compatibility,
  "shopifyReleaseProductId",
  "East Rock associated-album reference does not include the ReleaseCore parent product ID",
);

need(
  css,
  ".rc-sync-health-grid",
  "Sync health responsive styles are missing",
);
need(
  css,
  ".rc-sync-health-row",
  "Sync health row styles are missing",
);
need(
  css,
  ".rc-track-info-grid",
  "Edit Track Info styles are missing",
);
need(
  css,
  ".rc-bulk-track-fields",
  "Bulk Edit Tracks styles are missing",
);

if (failures.length) {
  console.error(
    "ReleaseCore M15.1 validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M15.1 distribution health/recovery + track editing validation passed.",
);
