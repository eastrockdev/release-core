#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const fail = (message) => {
  console.error(`ReleaseCore App Store readiness validation failed: ${message}`);
  process.exitCode = 1;
};

const configFiles = ["shopify.app.toml", "shopify.app.releasecore.toml"];
for (const file of configFiles) {
  if (!exists(file)) {
    fail(`${file} is missing.`);
    continue;
  }
  const toml = read(file);
  if (toml.includes("example.com")) fail(`${file} still contains an example.com URL.`);
  if (!toml.includes('client_id = "9eea48ea641cddd9fca95c0264a1499e"')) fail(`${file} is not linked to the ReleaseCore Shopify app.`);
  if (!toml.includes('application_url = "https://releasecore-web-production.up.railway.app"')) fail(`${file} must use the production ReleaseCore application URL.`);
  if (!toml.includes('"https://releasecore-web-production.up.railway.app/api/auth"')) fail(`${file} is missing the production auth redirect URL.`);
  if (!/api_version\s*=\s*"2026-07"/.test(toml)) fail(`${file} must use the stable 2026-07 webhook API version.`);
  if (!toml.includes('uri = "/webhooks/compliance"')) fail(`${file} is missing the compliance webhook endpoint.`);
  for (const topic of ["customers/data_request", "customers/redact", "shop/redact"]) {
    if (!toml.includes(topic)) fail(`${file} is missing ${topic}.`);
  }
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
  ]) {
    if (!new RegExp(`\\b${scope}\\b`).test(toml)) fail(`${file} is missing required scope ${scope}.`);
  }
  if (!toml.includes('[app_proxy]') || !toml.includes('subpath = "releasecore"')) fail(`${file} is missing the ReleaseCore app proxy configuration.`);
}

if (configFiles.every(exists) && read(configFiles[0]) !== read(configFiles[1])) {
  fail("shopify.app.toml and shopify.app.releasecore.toml have drifted; keep both configurations synchronized until the legacy alias is removed.");
}

const rootRoute = read("app/routes/_index/route.jsx");
if (/name=["']shop["']/.test(rootRoute) || rootRoute.includes("Shop domain") || rootRoute.includes("login(")) {
  fail("the public root route must not ask merchants to manually enter a Shopify shop domain.");
}
if (!rootRoute.includes("/privacy-policy") || !rootRoute.includes("/support")) {
  fail("the public root route must link to Privacy and Support.");
}

const authLoginRoute = read("app/routes/auth.login/route.jsx");
if (/name=["']shop["']/.test(authLoginRoute) || authLoginRoute.includes("Shop domain") || authLoginRoute.includes("useState")) {
  fail("the auth login route must not expose a manual shop-domain form.");
}
if (!authLoginRoute.includes("Open ReleaseCore from Shopify")) {
  fail("the auth login route must direct merchants back to the Shopify-owned installation/authentication flow.");
}

for (const [file, marker] of [
  ["app/routes/privacy-policy.jsx", "Privacy policy"],
  ["app/routes/support.jsx", "Get help with ReleaseCore"],
  ["app/routes/app.storefront-setup.jsx", "Add ReleaseCore blocks to the storefront"],
]) {
  if (!exists(file)) fail(`${file} is missing.`);
  else if (!read(file).includes(marker)) fail(`${file} is missing its expected readiness content.`);
}

const storefrontSetup = read("app/routes/app.storefront-setup.jsx");
for (const marker of ["addAppBlockId", "release-portal", "recent-releases", "artist-profile", 'target", "newAppsSection']) {
  if (!storefrontSetup.includes(marker)) fail(`storefront onboarding is missing ${marker}.`);
}

const appNav = read("app/routes/app.jsx");
if (!appNav.includes('/app/storefront-setup')) fail("merchant navigation is missing Storefront setup.");

const home = read("app/routes/app._index.jsx");
for (const marker of ["Getting started", "/app/settings", "/app/portal-access", "/app/storefront-setup"]) {
  if (!home.includes(marker)) fail(`App Home onboarding is missing ${marker}.`);
}

const shopifyServer = read("app/shopify.server.js");
if (!shopifyServer.includes("AppDistribution.AppStore")) fail("Shopify server must remain configured for App Store distribution.");
if (!/expiringOfflineAccessTokens\s*:\s*true/.test(shopifyServer)) fail("expiring offline access tokens must remain enabled.");

if (!exists("docs/APP-STORE-SUBMISSION.md")) fail("the App Store submission runbook is missing.");
else {
  const guide = read("docs/APP-STORE-SUBMISSION.md");
  for (const marker of [
    "Protected customer data",
    "Name field justification",
    "Email field justification",
    "Privacy policy URL",
    "Support",
    "Emergency developer contact",
    "Reviewer test instructions",
    "1200 × 1200",
  ]) {
    if (!guide.includes(marker)) fail(`App Store submission runbook is missing ${marker}.`);
  }
}


const packageJson = JSON.parse(read("package.json"));
if (packageJson?.scripts?.["verify:production"] !== "node scripts/verify-production.mjs") {
  fail("package.json must expose the production endpoint verifier as npm run verify:production.");
}
if (!exists("scripts/verify-production.mjs")) fail("the production endpoint verifier is missing.");
if (!exists("docs/PRODUCTION-VERIFICATION.md")) fail("the production verification runbook is missing.");

const appFiles = [];
function walkApp(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) walkApp(relative);
    else if (/\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name)) appFiles.push(relative);
  }
}
walkApp("app");
for (const file of appFiles) {
  const source = read(file);
  if (/\/admin\/api\//.test(source) || /admin\.rest\b/.test(source)) {
    fail(`${file} appears to use the legacy REST Admin API; new public apps must use GraphQL Admin API.`);
  }
}

const portalAsset = read("extensions/releasecore-artist-portal/assets/releasecore-portal.js");
const portalLocale = read("extensions/releasecore-artist-portal/locales/en.default.json");
const releasePortalLiquid = read("extensions/releasecore-artist-portal/blocks/release-portal.liquid");
const recentLiquid = read("extensions/releasecore-artist-portal/blocks/recent-releases.liquid");
for (const forbidden of [
  "ReleaseCore will remember",
  "records in ReleaseCore",
  "ReleaseCore returned",
  "reach ReleaseCore",
  "ReleaseCore did not return",
]) {
  if (portalAsset.includes(forbidden)) fail(`buyer-facing Release Portal copy contains unnecessary app-name branding: ${forbidden}.`);
}
for (const forbidden of ["ReleaseCore could not update", "used across ReleaseCore"]) {
  if (portalLocale.includes(forbidden)) fail(`buyer-facing Artist Profile copy contains unnecessary app-name branding: ${forbidden}.`);
}
if (releasePortalLiquid.includes("sample ReleaseCore releases") || recentLiquid.includes("sample ReleaseCore releases")) {
  fail("theme-extension preview copy should not unnecessarily brand sample release content with the app name.");
}

if (!process.exitCode) console.log("ReleaseCore App Store readiness validation passed.");
