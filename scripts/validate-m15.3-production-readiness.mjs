#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const warnings = [];

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function read(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    failures.push(`${rel} is missing.`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function need(source, marker, message) {
  if (!source.includes(marker)) fail(message);
}

function tomlString(source, key) {
  return (
    source.match(
      new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"),
    )?.[1] || null
  );
}

function assertNoDevelopmentUrls(source, label) {
  for (const forbidden of [
    "example.com",
    "localhost",
    "127.0.0.1",
    "trycloudflare.com",
    "ngrok-free.app",
  ]) {
    if (source.includes(forbidden)) {
      fail(`${label} contains development/example URL marker ${forbidden}.`);
    }
  }
}

function assertProductionConfig({
  file,
  clientId,
  appUrl,
  distributionLabel,
  requireOrders = false,
}) {
  const source = read(file);
  if (!source) return;

  if (tomlString(source, "client_id") !== clientId) {
    fail(`${file} is linked to the wrong Shopify client ID for ${distributionLabel}.`);
  }

  if (tomlString(source, "application_url") !== appUrl) {
    fail(`${file} must use ${appUrl}.`);
  }

  assertNoDevelopmentUrls(source, file);

  if (!/api_version\s*=\s*"2026-07"/.test(source)) {
    fail(`${file} must use stable Shopify webhook API version 2026-07 for the M15.3 production release.`);
  }

  if (/api_version\s*=\s*"2026-10"/.test(source)) {
    fail(`${file} is still targeting the 2026-10 release candidate.`);
  }

  if (/include_config_on_deploy\s*=/.test(source)) {
    fail(
      `${file} still contains include_config_on_deploy; current Shopify CLI deploys app configuration automatically.`,
    );
  }

  need(
    source,
    `${appUrl}/api/auth`,
    `${file} is missing its production auth redirect URL.`,
  );

  for (const [topic, uri] of [
    ["app/uninstalled", "/webhooks/app/uninstalled"],
    ["app/scopes_update", "/webhooks/app/scopes_update"],
    ["orders/paid", "/webhooks/orders/paid"],
    ["orders/cancelled", "/webhooks/orders/cancelled"],
    ["refunds/create", "/webhooks/refunds/create"],
  ]) {
    if (!source.includes(topic) || !source.includes(uri)) {
      fail(`${file} is missing ${topic} → ${uri}.`);
    }
  }

  for (const topic of [
    "customers/data_request",
    "customers/redact",
    "shop/redact",
  ]) {
    if (!source.includes(topic)) {
      fail(`${file} is missing compliance topic ${topic}.`);
    }
  }
  need(
    source,
    'uri = "/webhooks/compliance"',
    `${file} is missing the compliance webhook endpoint.`,
  );

  for (const scope of [
    "read_customers",
    "read_products",
    "write_products",
    "read_publications",
    "write_publications",
    "read_files",
    "write_files",
    "read_metaobject_definitions",
    "write_metaobject_definitions",
    "read_metaobjects",
    "write_metaobjects",
    "write_app_proxy",
    "read_orders",
  ]) {
    if (!new RegExp(`\\b${scope}\\b`).test(source)) {
      fail(`${file} is missing required scope ${scope}.`);
    }
  }

  if (requireOrders) {
    for (const scope of [
      "write_orders",
      "read_merchant_managed_fulfillment_orders",
      "write_merchant_managed_fulfillment_orders",
    ]) {
      if (!new RegExp(`\\b${scope}\\b`).test(source)) {
        fail(`${file} is missing East Rock operational scope ${scope}.`);
      }
    }
  }

  for (const marker of [
    "[app_proxy]",
    'url = "/releasecore-proxy"',
    'prefix = "apps"',
    'subpath = "releasecore"',
  ]) {
    need(source, marker, `${file} is missing app proxy setting ${marker}.`);
  }
}

const packageJson = JSON.parse(read("package.json") || "{}");
const scripts = packageJson.scripts || {};

for (const [name, expected] of [
  ["setup", "prisma generate && prisma migrate deploy"],
  ["docker-start", "npm run setup && npm run start"],
  ["verify:production", "node scripts/verify-production.mjs"],
  [
    "verify:production:releasecore",
    "node scripts/verify-production.mjs --profile releasecore",
  ],
  [
    "verify:production:east-rock",
    "node scripts/verify-production.mjs --profile east-rock",
  ],
  [
    "check:production-env",
    "node scripts/validate-production-environment.mjs",
  ],
  [
    "check:production-env:releasecore",
    "node scripts/validate-production-environment.mjs --profile releasecore",
  ],
  [
    "check:production-env:east-rock",
    "node scripts/validate-production-environment.mjs --profile east-rock",
  ],
  [
    "check:m15.3",
    "node scripts/validate-m15.3-production-readiness.mjs",
  ],
]) {
  if (scripts[name] !== expected) {
    fail(`package.json script ${name} must equal: ${expected}`);
  }
}

if (!String(scripts.check || "").includes("npm run check:m15.3")) {
  fail("Full npm run check chain is missing M15.3 production-readiness validation.");
}

const dockerfile = read("Dockerfile");
for (const marker of [
  "FROM node:22-alpine",
  "apk add --no-cache openssl ffmpeg",
  "RUN npm ci",
  "RUN npm run build",
  "RUN npm prune --omit=dev",
  "ENV NODE_ENV=production",
  "EXPOSE 3000",
  'CMD ["npm", "run", "docker-start"]',
]) {
  need(dockerfile, marker, `Dockerfile production contract is missing ${marker}.`);
}

const generic = read("shopify.app.releasecore.toml");
const genericAlias = read("shopify.app.toml");
if (generic && genericAlias && generic !== genericAlias) {
  fail(
    "shopify.app.toml and shopify.app.releasecore.toml have drifted; the generic App Store configuration aliases must remain byte-identical.",
  );
}

assertProductionConfig({
  file: "shopify.app.releasecore.toml",
  clientId: "9eea48ea641cddd9fca95c0264a1499e",
  appUrl: "https://releasecore-web-production.up.railway.app",
  distributionLabel: "generic ReleaseCore",
});
assertProductionConfig({
  file: "shopify.app.toml",
  clientId: "9eea48ea641cddd9fca95c0264a1499e",
  appUrl: "https://releasecore-web-production.up.railway.app",
  distributionLabel: "generic ReleaseCore alias",
});
assertProductionConfig({
  file: "shopify.app.east-rock.toml",
  clientId: "886119f2c8907b1f36c64dff6acb63bf",
  appUrl: "https://releasecore-er-production.up.railway.app",
  distributionLabel: "East Rock",
  requireOrders: true,
});

const releaseCoreProfile = JSON.parse(
  read("deployments/releasecore.profile.json") || "{}",
);
const eastRockProfile = JSON.parse(
  read("deployments/east-rock.profile.json") || "{}",
);

if (
  releaseCoreProfile.id !== "releasecore" ||
  releaseCoreProfile.distribution !== "app_store" ||
  releaseCoreProfile.shopifyConfigFile !== "shopify.app.releasecore.toml"
) {
  fail("Generic ReleaseCore deployment profile is not isolated as app_store.");
}

if (
  eastRockProfile.id !== "east-rock" ||
  eastRockProfile.distribution !== "single_merchant" ||
  eastRockProfile.shopifyConfigFile !== "shopify.app.east-rock.toml"
) {
  fail("East Rock deployment profile is not isolated as single_merchant.");
}

if (
  releaseCoreProfile.shopifyConfigFile === eastRockProfile.shopifyConfigFile ||
  releaseCoreProfile.id === eastRockProfile.id
) {
  fail("Generic ReleaseCore and East Rock deployment profiles are not isolated.");
}

const shopifyServer = read("app/shopify.server.js");
for (const marker of [
  "ApiVersion.July26",
  "RELEASECORE_APP_DISTRIBUTION",
  "AppDistribution.AppStore",
  "AppDistribution.SingleMerchant",
  "releaseCoreDistribution",
  "expiringOfflineAccessTokens: true",
]) {
  need(shopifyServer, marker, `app/shopify.server.js is missing ${marker}.`);
}
if (shopifyServer.includes("ApiVersion.October26")) {
  fail("app/shopify.server.js must remain on the stable July 2026 API for M15.3.");
}

const trackInfoRoute =
  "app/routes/app.release_.$releaseId.track.$trackId.jsx";
const bulkTrackRoute =
  "app/routes/app.release_.$releaseId.tracks.bulk.jsx";
const legacyTrackRoutes = [
  "app/routes/app.release_.$releaseId.tracks.jsx",
  "app/routes/app.release.$releaseId.tracks.jsx",
];

if (!exists(trackInfoRoute)) {
  fail(`${trackInfoRoute} is missing.`);
}
if (!exists(bulkTrackRoute)) {
  fail(`${bulkTrackRoute} is missing.`);
}
for (const legacyRoute of legacyTrackRoutes) {
  if (exists(legacyRoute)) {
    fail(
      `${legacyRoute} reintroduces the combined/nested Track editor architecture.`,
    );
  }
}

for (const rel of [
  "app/routes/privacy-policy.jsx",
  "app/routes/support.jsx",
  "app/routes/webhooks.compliance.jsx",
  "app/routes/webhooks.app.uninstalled.jsx",
  "app/routes/app.storefront-setup.jsx",
  "scripts/verify-production.mjs",
  "scripts/validate-production-environment.mjs",
  "docs/APP-STORE-SUBMISSION.md",
  "docs/PRODUCTION-VERIFICATION.md",
  "docs/M15.3-PRODUCTION-RELEASE.md",
  "scripts/validate-m15.3.1-track-editing-architecture.mjs",
]) {
  if (!exists(rel)) fail(`${rel} is missing.`);
}

const verifyProduction = read("scripts/verify-production.mjs");
for (const marker of [
  "--profile",
  "releasecore-web-production.up.railway.app",
  "releasecore-er-production.up.railway.app",
  "/privacy-policy",
  "/support",
  "/webhooks/compliance",
  "/webhooks/app/uninstalled",
]) {
  need(
    verifyProduction,
    marker,
    `Profile-aware production verifier is missing ${marker}.`,
  );
}

const productionEnv = read(
  "scripts/validate-production-environment.mjs",
);
for (const marker of [
  "RELEASECORE_DEPLOYMENT_PROFILE",
  "RELEASECORE_APP_DISTRIBUTION",
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "DATABASE_URL",
  "RELEASECORE_MASTER_STORAGE",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "RELEASECORE_ENCRYPTION_KEY",
]) {
  need(
    productionEnv,
    marker,
    `Production environment validator is missing ${marker}.`,
  );
}

const cliDocs = [
  read("docs/M15.3-PRODUCTION-RELEASE.md"),
  read("docs/PRODUCTION-VERIFICATION.md"),
  read("docs/APP-STORE-SUBMISSION.md"),
].join("\n");
if (
  /shopify app deploy[^\n]*--no-release[^\n]*--allow-updates|shopify app deploy[^\n]*--allow-updates[^\n]*--no-release/.test(
    cliDocs,
  )
) {
  fail(
    "M15.3 documentation contains the invalid --no-release / --allow-updates combination.",
  );
}

const productionGuide = read("docs/PRODUCTION-VERIFICATION.md");
for (const forbidden of [
  "releasecore-m11-6-review",
  "2026-10",
  "include_config_on_deploy",
]) {
  if (productionGuide.includes(forbidden)) {
    fail(
      `docs/PRODUCTION-VERIFICATION.md contains stale production marker ${forbidden}.`,
    );
  }
}
for (const marker of [
  "releasecore-m15-3-review",
  "verify:production:releasecore",
  "verify:production:east-rock",
  "check:production-env:releasecore",
  "check:production-env:east-rock",
  "--no-release",
]) {
  need(
    productionGuide,
    marker,
    `Production verification runbook is missing ${marker}.`,
  );
}

const submissionGuide = read("docs/APP-STORE-SUBMISSION.md");
for (const marker of [
  "releasecore-m15-3-review",
  "2026-07",
  "--no-release",
]) {
  need(
    submissionGuide,
    marker,
    `App Store submission runbook is missing ${marker}.`,
  );
}

const sourceRoots = ["app", "scripts"];
const sourceFiles = [];
function walk(relative) {
  const directory = path.join(root, relative);
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true,
  })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) walk(child);
    else if (/\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name)) {
      sourceFiles.push(child);
    }
  }
}
for (const sourceRoot of sourceRoots) walk(sourceRoot);

const artistProfileAsset =
  "extensions/releasecore-artist-portal/assets/releasecore-artist-profile.js";
if (!exists(artistProfileAsset)) {
  fail(`${artistProfileAsset} is missing.`);
} else {
  const artistProfileBytes = fs.statSync(
    path.join(root, artistProfileAsset),
  ).size;
  if (artistProfileBytes > 10000) {
    fail(
      `${artistProfileAsset} is ${artistProfileBytes} bytes; Shopify Theme Check requires app-block JavaScript to remain at or below 10000 bytes.`,
    );
  }
}

for (const rel of sourceFiles) {
  const source = read(rel);
  if (/\bdebugger\s*;/.test(source)) {
    fail(`${rel} contains a debugger statement.`);
  }
  if (/\bconsole\.debug\s*\(/.test(source)) {
    warn(`${rel} contains console.debug; review before final production sign-off.`);
  }
}

if (warnings.length) {
  console.warn("\nReleaseCore M15.3 production-readiness warnings:");
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}

if (failures.length) {
  console.error("\nReleaseCore M15.3 production-readiness validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `ReleaseCore M15.3 production-readiness validation passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.`,
);
