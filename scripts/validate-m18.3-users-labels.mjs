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
  if (!source.includes(needle)) {
    failures.push(`${rel}: missing ${label}`);
  }
}

expect("prisma/schema.prisma", "model PortalLabelAccount", "PortalLabelAccount model");
expect("prisma/schema.prisma", "portalLabelPlans", "tag-based label tier settings");
expect("prisma/schema.prisma", "pLineHolder", "release P-line holder");
expect("app/lib/portal-labels.server.js", "resolvePortalLabelPlan", "label tier resolver");
expect("app/lib/portal.server.js", "maxArtists", "portal roster limit enforcement");
expect("app/lib/portal.server.js", "pLineHolder", "portal P-line persistence");
expect("app/lib/shopify-products.server.js", "release.pLineHolder", "release-specific copyright metafield");
expect("app/lib/shopify-products.server.js", "release.labelName", "release-specific label metafield");
expect("app/routes/app.portal-access.jsx", 'heading="Users & Labels"', "Users & Labels admin page");
expect("app/routes/app.portal-access.jsx", "Label access tiers", "tag-to-limit admin controls");
expect("app/routes/api.portal-access.jsx", 'intent === "save-label-plans"', "label tier persistence");
expect("app/routes/releasecore-proxy.$.jsx", 'path === "portal/label"', "portal label endpoint");
expect("extensions/releasecore-artist-portal/assets/releasecore-dashboard.js", "data-native-label-form", "label name self-service");
expect("extensions/releasecore-artist-portal/assets/releasecore-dashboard.js", 'data-rc-nav="label"', "label/team portal navigation");
expect("extensions/releasecore-artist-portal/assets/releasecore-dashboard.js", "pLineHolder", "P-line dropdown UI");
expect("scripts/validate-tenant-hardening.mjs", "const accessWhere = portalReleaseCustomerWhere({ shop, customerId });", "artist-scoped tenant hardening marker");
expect("app/lib/privacy.server.js", "portalLabelAccount", "label account privacy export/redaction");
expect("app/lib/portal.server.js", "Choose an artist from this label/team roster", "release creation roster enforcement");
expect("app/lib/portal-dashboard.server.js", "assignedArtistCount >= maxArtists", "onboarding roster quota enforcement");
expect("scripts/validate-m18.0-artist-portal.mjs", "data-rc-native-release-grid", "historical M18.0 native release compatibility");
expect("package.json", '"check:m18.3"', "M18.3 validation script");

if (failures.length) {
  console.error("ReleaseCore M18.3 Users & Labels validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ReleaseCore M18.3 Users & Labels validation passed.");
