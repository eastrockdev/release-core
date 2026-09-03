import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const service = read("app/lib/publication-orchestration.server.js");
const catalog = read("app/lib/shopify-catalog.server.js");
const workspace = read("app/lib/distribution-workspace.server.js");
const distribution = read("app/lib/distribution.server.js");
const health = read("app/lib/distribution-health.server.js");
const admin = read("app/routes/app.distribution_.$releaseId.jsx");
const releaseAdmin = read("app/routes/app.release.$releaseId.jsx");
const trackEditor = read("app/routes/app.release_.$releaseId.tracks.jsx");
const css = read("app/styles/releasecore-admin.css");

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(service, "PUBLICATION_ORCHESTRATION_MODES", "publication mode registry is missing");
for (const mode of [
  "PUBLISH_NOW",
  "SCHEDULE_RELEASE",
  "KEEP_UNPUBLISHED",
  "UNPUBLISH_ALL",
]) {
  need(service, `"${mode}"`, `publication mode missing: ${mode}`);
}
need(service, "resolveReleasePublicationSchedule", "release timeline scheduling resolver is missing");
need(service, "preOrderEnabled", "pre-order publication timing is not considered");
need(service, "preOrderAudioPreviews", "pre-order preview behavior is not surfaced");
need(service, "releaseTimeEnabled", "release time is not considered");
need(service, "synchronousReleaseUnlocking", "synchronous unlock metadata is not considered");
need(service, "ianaTimezone", "Shopify IANA timezone is not used for schedule resolution");
need(service, "localDateTimeToUtcIso", "IANA local-to-UTC schedule conversion is missing");
need(service, "has already passed. Use Publish now", "past publication schedule guard is missing");
need(service, "orchestrateReleasePublication", "publication orchestration executor is missing");

if (
  service.includes(`orchestrateReleasePublication({
  admin,
  shop,`)
) {
  failures.push("publication orchestration still declares the unused shop argument");
}

if (fs.existsSync("app/routes/app.release.$releaseId.tracks.jsx")) {
  failures.push(
    "Track editor is nested under the release route and cannot render without an Outlet.",
  );
}

need(
  trackEditor,
  "ReleaseTrackEditor",
  "non-nested dedicated Track editor route is missing",
);
need(
  releaseAdmin,
  '/app/release/${release.id}/tracks',
  "release workspace does not navigate to the Track editor URL",
);
need(service, "Components first, parent last", "publish ordering does not protect bundle components");
need(service, "Parent first when taking a release offline", "unpublish ordering does not protect bundle parent");
need(service, "SHOPIFY_PUBLICATION_WARNING", "partial publication failures are not persisted");
need(service, "SHOPIFY_PUBLICATION_SCHEDULED", "scheduled publication audit event is missing");

need(catalog, "export async function setProductStatus", "catalog service does not expose controlled product status changes");

need(workspace, "buildPublicationOrchestration", "distribution workspace does not build publication orchestration state");
need(workspace, "publicationOrchestration", "distribution workspace payload is missing publication orchestration");

need(distribution, "orchestrateReleasePublication", "distribution service does not invoke publication orchestration");
need(distribution, 'intent === "orchestrate-publication"', "publication orchestration action is missing");

need(health, '"orchestrate-publication"', "publication orchestration failures are not tracked by sync health");
need(health, '"SHOPIFY_PUBLICATION_WARNING"', "publication warnings are not surfaced in operational history");

need(admin, "Storefront publication", "publication orchestration UI is missing");
need(admin, "PublicationOrchestrationPanel", "publication orchestration panel component is missing");
need(service, 'label: "Publish now"', "Publish now choice is missing");
need(admin, "Schedule for release timeline", "Schedule choice is missing");
need(service, 'label: "Keep unpublished"', "Keep unpublished choice is missing");
need(service, 'label: "Unpublish everything"', "Unpublish everything choice is missing");
need(admin, "Publication preview", "publication preview is missing");
need(admin, 'f.set("intent", "orchestrate-publication")', "publication UI does not submit orchestration action");
need(admin, "window.confirm", "publication execution confirmation is missing");

if (admin.includes('f.set("intent", "publish-shopify-product")')) {
  failures.push("per-track Publish now UI still exists");
}
if (admin.includes('f.set("intent", "schedule-shopify-product")')) {
  failures.push("per-track Schedule UI still exists");
}
if (admin.includes('f.set("intent", "unpublish-shopify-product")')) {
  failures.push("per-track Unpublish UI still exists");
}
if (admin.includes('f.set("intent", "publish-shopify-release-product")')) {
  failures.push("parent-product Publish now UI still exists");
}
if (admin.includes('f.set("intent", "schedule-shopify-release-product")')) {
  failures.push("parent-product Schedule UI still exists");
}
if (admin.includes('f.set("intent", "unpublish-shopify-release-product")')) {
  failures.push("parent-product Unpublish UI still exists");
}

need(css, ".rc-publication-mode-grid", "publication mode grid styles are missing");
need(css, ".rc-publication-preview", "publication preview styles are missing");
need(css, ".rc-publication-timeline", "publication timeline styles are missing");

if (failures.length) {
  console.error("ReleaseCore M15.2 validation failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log("ReleaseCore M15.2 publication orchestration validation passed.");
