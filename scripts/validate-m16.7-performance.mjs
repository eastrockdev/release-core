#!/usr/bin/env node
import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const helper = read(
  "app/lib/list-pagination.server.js",
);
const ui = read(
  "app/components/releasecore-ui.jsx",
);
const releases = read(
  "app/routes/app.releases.jsx",
);
const submissions = read(
  "app/routes/app.submissions.jsx",
);
const distribution = read(
  "app/routes/app.distribution.jsx",
);
const artists = read(
  "app/routes/app.artists.jsx",
);
const contributors = read(
  "app/routes/app.contributors.jsx",
);
const artistProfile = read(
  "app/routes/app.artist.$artistId.jsx",
);
const hygiene = read(
  "app/lib/data-hygiene.server.js",
);
const schema = read("prisma/schema.prisma");
const migration = read(
  "prisma/migrations/20260904070000_m16_7_performance_indexes/migration.sql",
);
const css = read(
  "app/styles/releasecore-admin.css",
);
const pkg = JSON.parse(read("package.json"));

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) {
    failures.push(message);
  }
};

for (const marker of [
  "paginationFromRequest",
  "paginationMeta",
  "maxPageSize",
]) {
  need(
    helper,
    marker,
    `Pagination helper is missing ${marker}.`,
  );
}

for (const marker of [
  "export function PaginationBar",
  "hasPrevious",
  "hasNext",
  "Page ",
]) {
  need(
    ui,
    marker,
    `Shared PaginationBar is missing ${marker}.`,
  );
}

for (const [name, source] of [
  ["Releases", releases],
  ["Submissions", submissions],
  ["Distribution", distribution],
  ["Artists", artists],
  ["Contributors", contributors],
]) {
  for (const marker of [
    "paginationFromRequest",
    "paginationMeta",
    "skip: pagination.skip",
    "take: pagination.take",
    "<PaginationBar",
  ]) {
    need(
      source,
      marker,
      `${name} pagination is missing ${marker}.`,
    );
  }
}

need(
  submissions,
  "db.release.groupBy",
  "Submissions still uses multiple per-status count queries.",
);
need(
  submissions,
  'reviewItems: {',
  "Submissions does not use a filtered relation count for open review items.",
);
need(
  distribution,
  "db.release.groupBy",
  "Distribution still uses multiple per-status count queries.",
);
need(
  releases,
  "select: {",
  "Releases list is not using a narrow select.",
);
need(
  artists,
  "select: {",
  "Artists list is not using a narrow select.",
);
need(
  contributors,
  "select: {",
  "Contributors list is not using a narrow select.",
);

for (const marker of [
  'url.searchParams.get("shopify") === "1"',
  "shopifyLoaded",
  "loadShopify",
  "Load existing Shopify collections",
]) {
  need(
    artistProfile,
    marker,
    `Artist profile lazy Shopify loading is missing ${marker}.`,
  );
}

if (
  !artistProfile.includes(
    "loadShopify\n    ? await Promise.all",
  ) &&
  !artistProfile.includes(
    "loadShopify ? await Promise.all",
  )
) {
  failures.push(
    "Artist profile does not gate Shopify collection network work behind loadShopify.",
  );
}

for (const marker of [
  "candidatePairs",
  "artistContributorCandidates",
  "addCandidate",
]) {
  need(
    hygiene,
    marker,
    `Data Hygiene candidate indexing is missing ${marker}.`,
  );
}

if (
  /for\s*\(let\s+j\s*=\s*i\s*\+\s*1;\s*j\s*<\s*artists\.length/.test(
    hygiene,
  ) ||
  /for\s*\(let\s+j\s*=\s*i\s*\+\s*1;\s*j\s*<\s*contributors\.length/.test(
    hygiene,
  ) ||
  /for\s*\(const\s+artist\s+of\s+artists\)[\s\S]{0,300}?for\s*\(const\s+contributor\s+of\s+contributors\)/.test(
    hygiene,
  )
) {
  failures.push(
    "Data Hygiene still contains full quadratic identity scans.",
  );
}

for (const marker of [
  "@@index([shop, updatedAt])",
  "@@index([shop, lastSubmittedAt])",
  "@@index([shop, distributionUpdatedAt])",
]) {
  need(
    schema,
    marker,
    `Prisma schema is missing ${marker}.`,
  );
}

for (const marker of [
  '"Release_shop_updatedAt_idx"',
  '"Release_shop_lastSubmittedAt_idx"',
  '"Release_shop_distributionUpdatedAt_idx"',
]) {
  need(
    migration,
    marker,
    `M16.7 migration is missing ${marker}.`,
  );
}

for (const marker of [
  ".rc-pagination",
  ".rc-pagination__summary",
]) {
  need(
    css,
    marker,
    `M16.7 pagination CSS is missing ${marker}.`,
  );
}

if (
  pkg?.scripts?.["check:m16.7"] !==
  "node scripts/validate-m16.7-performance.mjs"
) {
  failures.push(
    "package.json is missing check:m16.7.",
  );
}

if (
  !String(pkg?.scripts?.check || "").includes(
    "npm run check:m16.7",
  )
) {
  failures.push(
    "Full npm run check does not include M16.7.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M16.7 performance validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M16.7 pagination / query efficiency / lazy Shopify loading validation passed.",
);
