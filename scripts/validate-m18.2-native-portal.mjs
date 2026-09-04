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

function reject(rel, needle, label = needle) {
  const source = read(rel);
  if (source.includes(needle)) failures.push(`${rel}: still contains ${label}`);
}

expect(
  "extensions/releasecore-artist-portal/assets/releasecore-dashboard.js",
  "data-native-open-release",
  "native release browser",
);
expect(
  "extensions/releasecore-artist-portal/assets/releasecore-dashboard.js",
  "data-native-profile-form",
  "native artist profile editor",
);
expect(
  "extensions/releasecore-artist-portal/assets/releasecore-dashboard.js",
  "portal/uploads/master/stage",
  "native R2 master upload support",
);
expect(
  "extensions/releasecore-artist-portal/assets/releasecore-dashboard.css",
  "RELEASECORE_M18_2_NATIVE_APP_SURFACES",
  "M18.2 native app styling",
);
expect(
  "extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid",
  "data-rc-native-release-grid",
  "native release view markup",
);
expect(
  "extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid",
  "data-rc-native-profile",
  "native profile view markup",
);
expect(
  "scripts/validate-m18.0-artist-portal.mjs",
  "data-rc-native-release-grid",
  "M18.0 validator native release compatibility",
);
expect(
  "scripts/validate-m18.0-artist-portal.mjs",
  "data-rc-native-profile",
  "M18.0 validator native profile compatibility",
);

expect(
  "extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid",
  "\"id\": \"show_publisher\"",
  "publisher visibility setting",
);
expect(
  "extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid",
  "\"id\": \"show_publisher_ipi\"",
  "publisher IPI visibility setting",
);
reject(
  "extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid",
  "data-rc-portal",
  "legacy embedded release portal",
);
reject(
  "extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid",
  "data-rc-artist-profile",
  "legacy embedded artist profile",
);
reject(
  "extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid",
  "releasecore-artist-profile.js",
  "legacy profile JavaScript include",
);
reject(
  "extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid",
  "releasecore-portal.js",
  "legacy release JavaScript include",
);
expect(
  "app/lib/portal.server.js",
  "artistId = null",
  "artist-scoped portal release listing",
);
expect(
  "app/lib/portal-dashboard.server.js",
  "artistId: selectedArtist.id",
  "selected-artist dashboard release scope",
);
expect(
  "app/routes/releasecore-proxy.$.jsx",
  "identity.url.searchParams.get(\"artist\")",
  "artist-scoped portal releases endpoint",
);
expect("package.json", "\"check:m18.2\"", "M18.2 validation script");

if (failures.length) {
  console.error("ReleaseCore M18.2 validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ReleaseCore M18.2 native Artist Portal validation passed.");
