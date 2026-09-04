import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    failures.push(`Missing ${rel}`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function expect(rel, needle, label = needle) {
  const source = read(rel);
  if (!source.includes(needle)) failures.push(`${rel}: missing ${label}`);
}

expect("app/lib/credit-types.js", "CORE_CREDIT_ROLES", "core credit role registry");
expect("app/lib/credit-types.js", "configuredCreditRoles", "configured credit role resolver");
expect("prisma/schema.prisma", "additionalCreditRoles", "AppSettings additional credit roles");
expect(
  "prisma/migrations/20260904220000_m17_5_configurable_credit_roles/migration.sql",
  'ADD COLUMN "additionalCreditRoles"',
  "M17.5 credit-role migration",
);
expect("app/routes/app.settings_.preferences.jsx", "Contributor credit types", "credit type settings UI");
expect("app/routes/app.settings_.preferences.jsx", 'f.set("additionalCreditRoles"', "credit type settings payload");
expect("app/routes/api.settings.jsx", "serializeAdditionalCreditRoles", "credit role settings normalization");
expect("app/lib/api-releases-release-action.server.js", "configuredCreditRoles(appSettings)", "admin credit validation");
expect("app/lib/inline-track-identities.server.js", "configuredCreditRoles(roleSettings)", "inline contributor credit validation");
expect("app/lib/portal.server.js", "configuredCreditRoles(settings)", "portal credit validation");
expect("app/routes/releasecore-proxy.$.jsx", "configuredCreditRoles(portalSettings)", "portal credit options");
expect("app/routes/app.release_.$releaseId.track.$trackId.jsx", "configuredCreditRoles(workflowSettings)", "admin track credit options");

expect("app/lib/east-rock-compatibility.server.js", 'metafield("associated_album", "product_reference", associatedAlbum)', "East Rock associated_album mapping");
expect("app/lib/shopify-products.server.js", "syncEastRockAssociatedAlbumReferences", "deterministic associated album sync");
expect("app/lib/shopify-products.server.js", 'namespace: "custom"', "custom namespace associated album write");
expect("app/lib/shopify-products.server.js", 'key: "associated_album"', "associated_album key");
expect("app/lib/distribution.server.js", "syncEastRockAssociatedAlbumReferences", "Album/EP sync association backfill");

expect("package.json", '"check:m17.5"', "M17.5 validation script");

if (failures.length) {
  console.error("ReleaseCore M17.5 validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ReleaseCore M17.5 configurable credits / associated-album validation passed.");
