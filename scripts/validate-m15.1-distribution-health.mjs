import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const health = read("app/lib/distribution-health.server.js");
const catalog = read("app/lib/shopify-catalog.server.js");
const workspace = read("app/lib/distribution-workspace.server.js");
const distribution = read("app/lib/distribution.server.js");
const api = read("app/routes/api.distribution.$releaseId.jsx");
const admin = read("app/routes/app.distribution_.$releaseId.jsx");
const releaseAdmin = read("app/routes/app.release.$releaseId.jsx");
const trackEditor = read("app/routes/app.release_.$releaseId.tracks.jsx");
const bulkService = read("app/lib/bulk-track-edit.server.js");
const compatibility = read("app/lib/east-rock-compatibility.server.js");
const css = read("app/styles/releasecore-admin.css");

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(health, "runDistributionPreflight", "distribution preflight service is missing");
need(health, "CUSTOM_CHOICE_INVALID", "custom choice-field preflight is missing");
need(health, "getReleaseCoreMetafieldStatus", "ReleaseCore metafield definition preflight is missing");
need(health, "buildDistributionHealth", "sync health builder is missing");
need(health, "retryDistributionHealth", "targeted sync retry service is missing");
need(health, "SHOPIFY_SYNC_FAILED", "sync failure history is missing");
need(health, "SHOPIFY_SYNC_WARNING", "sync warning history is missing");
need(health, "SHOPIFY_SYNC_RETRY_SUCCEEDED", "sync retry success history is missing");

need(catalog, "releasecoreMetafields: metafields", "track/release product state does not read ReleaseCore metafields");
need(catalog, "customMetafields: metafields", "track product state does not read merchant custom metafields");
need(catalog, "metafields: product.releasecoreMetafields", "Shopify state does not expose ReleaseCore metafields to health checks");
need(catalog, "price:", "release product state does not expose the current variant price for targeted retry");

need(workspace, "runDistributionPreflight", "distribution workspace does not run preflight");
need(workspace, "buildDistributionHealth", "distribution workspace does not expose sync health");
need(workspace, "syncHealth", "distribution workspace payload is missing sync health");

need(distribution, 'intent === "retry-sync-health"', "distribution action does not support targeted retry");
need(distribution, 'assertDistributionPreflight(preflight, "TRACKS")', "track product sync is not guarded by preflight");
need(distribution, 'assertDistributionPreflight(preflight, "RELEASE")', "Album/EP sync is not guarded by preflight");
need(distribution, "recordDistributionSyncWarning", "non-fatal Shopify sync warnings are not persisted");
need(distribution, "associated album reference sync was deferred", "Album/EP parent sync does not independently retry track association metadata");

need(api, "recordDistributionFailure", "distribution API does not persist sync failures");
need(api, "shop,", "distribution errors still omit shop context");

need(admin, "Sync health", "Distribution Admin is missing Sync health UI");
need(admin, "Retry failed items", "Distribution Admin is missing targeted retry action");
need(admin, "Run preflight again", "Distribution Admin is missing preflight refresh action");
need(admin, '"retry-sync-health"', "Distribution Admin does not submit retry-sync-health");
need(admin, "lastSuccessfulSync", "Distribution Admin does not show sync history");
need(
  admin,
  "ISRC assignment and corrections are managed in Track editor",
  "Distribution still exposes a separate ISRC editing workflow.",
);
if (/name=[\"']isrc[\"']/.test(admin)) {
  failures.push("Distribution still contains a named/editable ISRC input.");
}

need(releaseAdmin, "TrackEditorLaunch", "release workspace does not launch the dedicated Track editor");
need(
  releaseAdmin,
  "ISRC is managed in the dedicated Track editor",
  "release workspace does not identify the dedicated ISRC editing surface",
);
if (releaseAdmin.includes("function BulkTrackEditor")) {
  failures.push("release workspace still contains the old inline/modal BulkTrackEditor");
}
need(trackEditor, "ReleaseTrackEditor", "dedicated Track editor route is missing");
need(trackEditor, "Single-track editing", "dedicated Track editor does not support Singles");
need(trackEditor, "Save all track changes", "dedicated Track editor batch save is missing");
need(trackEditor, "name={`position:${track.id}`}", "Track editor cannot bulk-edit track order");
need(trackEditor, "name={`lyrics:${track.id}`}", "Track editor cannot bulk-edit lyrics");
need(trackEditor, "name={`isrc:${track.id}`}", "Track editor ISRC correction field is missing");

need(bulkService, "data: { position: -(index + 1) }", "track reordering is not atomic");
need(bulkService, "data.lyrics = row.lyrics", "lyrics are not persisted by the bulk service");
need(bulkService, "data: { isrc: null }", "ISRC swaps are not atomic");

need(compatibility, "shopifyReleaseProductId", "East Rock associated-album reference does not include the ReleaseCore parent product ID");

need(css, ".rc-sync-health-grid", "Sync health responsive styles are missing");
need(css, ".rc-sync-health-row", "Sync health row styles are missing");
need(css, ".rc-track-editor-grid", "Dedicated Track editor styles are missing");
need(css, ".rc-track-editor-card", "Dedicated Track editor card styles are missing");

if (failures.length) {
  console.error("ReleaseCore M15.1 validation failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log("ReleaseCore M15.1 distribution health/recovery + dedicated Track editor validation passed.");
