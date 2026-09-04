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

expect("prisma/schema.prisma", "publisherName", "Artist publisher name");
expect("prisma/schema.prisma", "publisherIpi", "Artist publisher IPI");
expect(
  "prisma/migrations/20260904230000_m18_0_artist_portal/migration.sql",
  'ADD COLUMN "publisherName"',
  "M18.0 Artist publisher migration",
);
expect("app/lib/portal-dashboard.server.js", "portalDashboardState", "dashboard server state");
expect("app/lib/portal-dashboard.server.js", "portalMembership", "server-side membership gate");
expect("app/lib/portal-dashboard.server.js", "savePortalOnboarding", "artist onboarding persistence");
expect("app/lib/portal-dashboard.server.js", 'metafield(namespace: "custom", key: "artist_stage_name")', "legacy customer prefill");
expect("app/routes/releasecore-proxy.$.jsx", 'path === "portal/dashboard"', "dashboard proxy endpoint");
expect("app/routes/releasecore-proxy.$.jsx", 'path === "portal/onboarding"', "onboarding proxy endpoint");
expect("app/routes/releasecore-proxy.$.jsx", "membershipRequired", "membership denial contract");
expect("app/lib/artist-profile.server.js", "publisherName", "profile publisher name");
expect("app/lib/artist-profile.server.js", "publisherIpi", "profile publisher IPI");
expect("extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid", '"name": "Artist dashboard"', "dashboard app block");
expect("extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid", '"type": "link_list"', "merchant supplemental navigation");
expect("extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid", "data-rc-portal", "embedded releases workspace");
expect("extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid", "data-rc-artist-profile", "embedded profile workspace");
expect("extensions/releasecore-artist-portal/assets/releasecore-dashboard.js", "membershipAttempts", "Flow activation retry");
expect("extensions/releasecore-artist-portal/assets/releasecore-dashboard.js", "openNewRelease", "new release integration");
expect("extensions/releasecore-artist-portal/assets/releasecore-dashboard.css", "rc-app-mobile-nav", "mobile dashboard navigation");
expect("extensions/releasecore-artist-portal/assets/releasecore-artist-profile.js", '"publisherName"', "profile JS publisher field");
expect("extensions/releasecore-artist-portal/blocks/artist-profile.liquid", 'name="publisherName"', "standalone profile publisher field");
expect("package.json", '"check:m18.0"', "M18.0 validation script");

if (failures.length) {
  console.error("ReleaseCore M18.0 Artist Portal validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ReleaseCore M18.0 Artist Portal validation passed.");
