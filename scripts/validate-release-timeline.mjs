import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
let failed = false;
const exists = (relative) => fs.existsSync(path.join(root, relative));
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const fail = (message) => {
  failed = true;
  console.error(`ReleaseCore release timeline validation failed: ${message}`);
};

for (const relative of [
  "app/lib/release-timeline.server.js",
  "prisma/schema.prisma",
  "app/lib/api-releases-release-action.server.js",
  "app/lib/portal.server.js",
  "app/routes/app.release.$releaseId.jsx",
  "extensions/releasecore-artist-portal/assets/releasecore-portal.js",
  "app/lib/shopify-products.server.js",
]) {
  if (!exists(relative)) fail(`${relative} is missing.`);
}

if (exists("prisma/schema.prisma")) {
  const schema = read("prisma/schema.prisma");
  for (const field of [
    "availability",
    "preOrderEnabled",
    "preOrderDate",
    "preOrderAudioPreviews",
    "releaseTimeEnabled",
    "releaseTime",
    "synchronousReleaseUnlocking",
    "exclusiveEnabled",
    "exclusivePartner",
    "exclusivePeriodWeeks",
  ]) {
    if (!schema.includes(field)) fail(`Prisma Release is missing ${field}.`);
  }
}

for (const [relative, markers] of [
  [
    "app/lib/api-releases-release-action.server.js",
    ["parseReleaseTimelineFormData", "...timeline"],
  ],
  [
    "app/lib/portal.server.js",
    ["parseReleaseTimelineFormData", "...timeline"],
  ],
  [
    "app/routes/app.release.$releaseId.jsx",
    [
      "ReleaseTimelineFields",
      'name="preOrderEnabled"',
      'name="preOrderDate"',
      'name="releaseTimeEnabled"',
      'name="exclusivePartner"',
      'name="exclusivePeriodWeeks"',
    ],
  ],
  [
    "extensions/releasecore-artist-portal/assets/releasecore-portal.js",
    [
      "releaseTimelineMarkup",
      'name="preOrderEnabled"',
      'name="preOrderDate"',
      'name="releaseTimeEnabled"',
      'name="exclusivePartner"',
      'name="exclusivePeriodWeeks"',
    ],
  ],
]) {
  if (!exists(relative)) continue;
  const source = read(relative);
  for (const marker of markers) {
    if (!source.includes(marker)) fail(`${relative} is missing ${marker}.`);
  }
}

if (exists("app/lib/shopify-products.server.js")) {
  const source = read("app/lib/shopify-products.server.js");
  for (const marker of [
    '"Pre Order Date", "pre_order_date", "date"',
    'metafield("pre_order_date"',
    'metafield("availability"',
  ]) {
    if (!source.includes(marker)) {
      fail(`Shopify product metadata is missing ${marker}.`);
    }
  }
}

if (exists("app/lib/east-rock-compatibility.server.js")) {
  const source = read("app/lib/east-rock-compatibility.server.js");
  if (!source.includes('"pre_order_date"')) {
    fail("East Rock compatibility is missing custom.pre_order_date.");
  }
}

if (failed) process.exit(1);
console.log("ReleaseCore release timeline validation passed.");
