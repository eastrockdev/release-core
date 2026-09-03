import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
let failed = false;

function read(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    failed = true;
    console.error(`ReleaseCore M14.4.1 validation failed: ${relative} is missing.`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function requireMarkers(relative, markers) {
  const source = read(relative);
  for (const marker of markers) {
    if (!source.includes(marker)) {
      failed = true;
      console.error(`ReleaseCore M14.4.1 validation failed: ${relative} is missing ${marker}.`);
    }
  }
}

requireMarkers("app/lib/release-drafts.server.js", [
  "deleteReleaseDraft",
  'release.status !== "DRAFT"',
  "release.submittedAt || release.lastSubmittedAt",
  "shopifyReleaseProductId",
  "deleteMasterStorageObject",
]);

requireMarkers("app/lib/api-releases-release-action.server.js", [
  'intent === "delete-draft"',
  "deleteReleaseDraft",
]);

requireMarkers("app/routes/releasecore-proxy.$.jsx", [
  'intent === "delete-draft"',
  "deleteReleaseDraft",
  "ownerCustomerId: identity.customerId",
]);

requireMarkers("app/routes/app.release.$releaseId.jsx", [
  '"delete-draft"',
  "Delete draft",
  'navigate("/app/releases"',
]);

requireMarkers("extensions/releasecore-artist-portal/assets/releasecore-portal.js", [
  'data-action="delete-draft"',
  "Delete this draft permanently?",
  "form.set('intent','delete-draft')",
]);

// Preserve the other East Rock production fixes that were part of the M14.4.1 handoff.
requireMarkers("app/routes/app.import.jsx", [
  "useLoaderData",
  "importedProducts",
  "already imported into ReleaseCore",
]);
requireMarkers("app/lib/import-product.server.js", [
  "already been imported into ReleaseCore",
  "status: 409",
]);
requireMarkers("app/lib/shopify-artist-collections.server.js", [
  'deploymentProfileId() === "east-rock"',
  'value: "Artist"',
]);
requireMarkers("shopify.app.east-rock.toml", [
  "[app_proxy]",
  'url = "/releasecore-proxy"',
  'prefix = "apps"',
  'subpath = "releasecore"',
  "include_config_on_deploy = true",
  "write_app_proxy",
]);
requireMarkers("app/routes/app.release.$releaseId.jsx", [
  "preOrderEnabled",
  "preOrderDate",
  "preOrderAudioPreviews",
]);
requireMarkers("extensions/releasecore-artist-portal/assets/releasecore-portal.js", [
  "preOrderEnabled",
  "Pre-Order Date",
  "preOrderAudioPreviews",
]);

if (failed) process.exit(1);
console.log("ReleaseCore M14.4.1 East Rock recovery validation passed.");
