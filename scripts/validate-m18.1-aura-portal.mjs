import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const read = (rel) => {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    failures.push(`Missing ${rel}`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
};

const expect = (rel, needle, label = needle) => {
  const source = read(rel);
  if (!source.includes(needle)) failures.push(`${rel}: missing ${label}`);
};

expect(
  "extensions/releasecore-artist-portal/assets/releasecore-dashboard.css",
  "RELEASECORE_M18_1_AURA_REFINEMENT",
  "M18.1 Aura CSS marker",
);
expect(
  "extensions/releasecore-artist-portal/assets/releasecore-dashboard.css",
  ".rc-app-dashboard .rc-artist-profile",
  "embedded artist-profile containment fix",
);
expect(
  "extensions/releasecore-artist-portal/assets/releasecore-dashboard.css",
  ".rc-app-menu-group",
  "nested menu styling",
);
expect(
  "extensions/releasecore-artist-portal/assets/releasecore-dashboard.js",
  "averageImageColor",
  "cover-art color extraction",
);
expect(
  "extensions/releasecore-artist-portal/assets/releasecore-dashboard.js",
  "--rc-aura-image",
  "cover-art Aura background",
);
expect(
  "extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid",
  "rc-app-menu-children--level-3",
  "three-level Shopify Navigation support",
);
expect(
  "extensions/releasecore-artist-portal/blocks/artist-dashboard.liquid",
  "<details class=\"rc-app-menu-group\">",
  "desktop nested menu disclosure",
);
expect("package.json", "\"check:m18.1\"", "M18.1 validation script");

if (failures.length) {
  console.error("ReleaseCore M18.1 validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ReleaseCore M18.1 Aura / nested-menu UX validation passed.");
