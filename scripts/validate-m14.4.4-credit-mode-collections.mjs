import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const settings = read("app/routes/app.settings.jsx");
const action = read("app/lib/api-releases-release-action.server.js");
const admin = read("app/routes/app.release.$releaseId.jsx");
const portalServer = read("app/lib/portal.server.js");
const proxy = read("app/routes/releasecore-proxy.$.jsx");
const portal = read("extensions/releasecore-artist-portal/assets/releasecore-portal.js");
const collections = read("app/lib/shopify-artist-collections.server.js");
const m1441 = read("scripts/validate-release-draft-deletion.mjs");
const appProxyValidator = read("scripts/validate-east-rock-app-proxy.mjs");

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(settings, 'value={requirePublishing ? "CREDITS_AND_SPLITS" : "CREDITS_ONLY"}', "Settings does not expose Credits-only vs Credits & splits.");
need(settings, '<option value="CREDITS_ONLY">Credits only</option>', "Credits-only option is missing.");
need(settings, '<option value="CREDITS_AND_SPLITS">Credits &amp; splits</option>', "Credits & splits option is missing.");
need(action, 'intent !== "update-credit"', "Admin credit correction is still blocked by release locking.");
need(action, 'const creditSplitsEnabled = appSettings?.requirePublishing ?? true;', "Admin mutations do not respect the credit mode.");
need(admin, 'creditSplitsEnabled={workflowSettings?.requirePublishing ?? true}', "Admin release UI does not receive the credit mode.");
need(admin, '{creditSplitsEnabled ? "Credits & splits" : "Credits"}', "Admin credit section does not reflect the mode.");
need(admin, '<button disabled={adminBusy}', "Admin credit Save is still disabled on locked catalog releases.");
need(portalServer, 'creditSplitsEnabled: settings?.requirePublishing ?? true', "Portal detail does not expose the credit mode.");
need(portalServer, 'export async function updatePortalCredit', "Portal existing-credit update service is missing.");
need(proxy, 'intent === "update-credit"', "Portal existing-credit update route is missing.");
need(portal, 'data-form="credit-update"', "Portal existing-credit edit form is missing.");
need(portal, "state.detail?.creditSplitsEnabled === false ? 'Credits' : 'Credits & splits'", "Portal credit heading does not reflect the mode.");
need(collections, '...(productIds.length', "Artist collection create path still always creates a zero-selection source.");
need(collections, 'if (!source && desiredProductIds.length)', "Existing collection linking still creates an empty conditions source.");

if (m1441.includes("include_config_on_deploy = true")) {
  failures.push("M14.4.1 validator still requires Shopify CLI's deprecated include_config_on_deploy field.");
}
if (appProxyValidator.includes("include_config_on_deploy = true")) {
  failures.push("East Rock app proxy validator still requires Shopify CLI's deprecated include_config_on_deploy field.");
}

if (failures.length) {
  console.error("ReleaseCore M14.4.4 validation failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log("ReleaseCore M14.4.4 credits/collection validation passed.");
