import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const coreOnly = process.argv.includes("--core-only");
let failed = false;

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
}

function fail(message) {
  failed = true;
  console.error(`ReleaseCore purchased-music validation failed: ${message}`);
}

for (const relative of [
  "app/lib/commerce-library.server.js",
  "app/routes/customer-account.downloads.jsx",
  "app/routes/customer-downloads.file.jsx",
  "app/routes/app.purchases.jsx",
  "extensions/releasecore-artist-portal/blocks/purchased-music.liquid",
  "extensions/releasecore-artist-portal/assets/releasecore-purchased-music.css",
  "extensions/releasecore-artist-portal/assets/releasecore-purchased-music.js",
]) {
  if (!exists(relative)) fail(`${relative} is missing.`);
}

if (exists("app/lib/customer-downloads.server.js")) {
  const source = read("app/lib/customer-downloads.server.js");
  for (const marker of [
    "inspectCustomerDownloadFiles",
    "rebuildCustomerDownloadFiles",
    '"STALE"',
    '"NO_MASTER"',
    "derivativeFingerprint",
  ]) {
    if (!source.includes(marker)) {
      fail(`customer download service is missing ${marker}.`);
    }
  }
}

if (exists("app/lib/commerce-entitlements.server.js")) {
  const source = read("app/lib/commerce-entitlements.server.js");
  for (const marker of [
    "inspectCustomerDownloadFiles",
    "state:",
    "downloadPath:",
  ]) {
    if (!source.includes(marker)) {
      fail(`commerce entitlement service is missing ${marker}.`);
    }
  }
}

if (exists("app/lib/commerce-library.server.js")) {
  const source = read("app/lib/commerce-library.server.js");
  for (const marker of [
    "buildCustomerAccountLibrary",
    "resolveCustomerAccountDownload",
    "listPurchasedMusicAdmin",
    "rebuildPurchasedTrackFiles",
    "rebuildPurchasedReleaseFiles",
    "guestOrderAccessToken",
    "TOKEN_LIFETIME_SECONDS",
  ]) {
    if (!source.includes(marker)) {
      fail(`purchased-music service is missing ${marker}.`);
    }
  }
  if (source.includes('kind: "MASTER_WAV"')) {
    fail("purchased-music service must not directly resolve MASTER_WAV.");
  }
}

if (exists("app/routes/customer-account.downloads.jsx")) {
  const source = read("app/routes/customer-account.downloads.jsx");
  for (const marker of [
    "authenticate.public.customerAccount",
    "sessionToken?.dest",
    "sessionToken?.sub",
    "buildCustomerAccountLibrary",
    "cors(Response.json(",
  ]) {
    if (!source.includes(marker)) {
      fail(`customer-account route is missing ${marker}.`);
    }
  }

  if (/return\s+cors\s*\(\s*\{/.test(source)) {
    fail(
      "customer-account route passes a plain object to Shopify cors(); wrap the JSON body in Response.json().",
    );
  }
}

if (exists("app/routes/customer-downloads.file.jsx")) {
  const source = read("app/routes/customer-downloads.file.jsx");
  for (const marker of [
    "resolveCustomerAccountDownload",
    'disposition: "attachment"',
    '"Cache-Control": "private, no-store"',
  ]) {
    if (!source.includes(marker)) {
      fail(`customer download route is missing ${marker}.`);
    }
  }
  if (source.includes("MASTER_WAV")) {
    fail("customer download route contains a buyer MASTER_WAV path.");
  }
}

if (exists("app/routes/app.jsx")) {
  const source = read("app/routes/app.jsx");
const settingsHub = read("app/routes/app.settings.jsx");
  if (!source.includes('href="/app/purchases"') && !settingsHub.includes("/app/purchases")) {
    fail("admin navigation is missing Purchases.");
  }
}

if (exists("app/routes/app.purchases.jsx")) {
  const source = read("app/routes/app.purchases.jsx");
  for (const marker of [
    'heading="Purchases"',
    "Copy guest download link",
    "Rebuild release files",
    "Rebuild",
  ]) {
    if (!source.includes(marker)) {
      fail(`Purchases workspace is missing ${marker}.`);
    }
  }
}

if (exists("extensions/releasecore-artist-portal/blocks/purchased-music.liquid")) {
  const source = read(
    "extensions/releasecore-artist-portal/blocks/purchased-music.liquid",
  );
  for (const marker of [
    '"name": "Purchased music"',
    "apps/releasecore/downloads",
    "releasecore-purchased-music.css",
    "releasecore-purchased-music.js",
  ]) {
    if (!source.includes(marker)) {
      fail(`Purchased music theme block is missing ${marker}.`);
    }
  }
}

if (
  exists(
    "extensions/releasecore-artist-portal/assets/releasecore-purchased-music.js",
  )
) {
  const size = fs.statSync(
    path.join(
      root,
      "extensions/releasecore-artist-portal/assets/releasecore-purchased-music.js",
    ),
  ).size;
  if (size > 10000) {
    fail(
      `releasecore-purchased-music.js is ${size} bytes; keep the app-block JavaScript at or below 10000 bytes.`,
    );
  }
}

if (exists("package.json")) {
  const pkg = JSON.parse(read("package.json"));
  if (pkg.scripts?.["check:purchased-music"] !==
      "node scripts/validate-purchased-music.mjs") {
    fail("package.json is missing check:purchased-music.");
  }
  if (!String(pkg.scripts?.check || "").includes(
    "npm run check:purchased-music",
  )) {
    fail("npm run check does not include check:purchased-music.");
  }
}

if (!coreOnly) {
  const extensionsDir = path.join(root, "extensions");
  const candidates = fs.existsSync(extensionsDir)
    ? fs
        .readdirSync(extensionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(extensionsDir, entry.name))
    : [];

  const customerAccountDir = candidates.find((directory) => {
    const config = path.join(directory, "shopify.extension.toml");
    if (!fs.existsSync(config)) return false;
    const source = fs.readFileSync(config, "utf8");
    return source.includes('handle = "releasecore-purchased-music"');
  });

  if (!customerAccountDir) {
    fail(
      "the ReleaseCore customer-account Music downloads extension is not bootstrapped.",
    );
  } else {
    const config = fs.readFileSync(
      path.join(customerAccountDir, "shopify.extension.toml"),
      "utf8",
    );
    const sourcePath = path.join(
      customerAccountDir,
      "src",
      "MusicDownloads.jsx",
    );
    const extensionSource = fs.existsSync(sourcePath)
      ? fs.readFileSync(sourcePath, "utf8")
      : "";

    for (const marker of [
      'target = "customer-account.page.render"',
      "network_access = true",
      'uid = "',
      'key = "api_base_url"',
    ]) {
      if (!config.includes(marker)) {
        fail(`customer-account extension config is missing ${marker}.`);
      }
    }

    for (const marker of [
      "shopify.sessionToken.get()",
      "shopify.settings.value?.api_base_url",
      "/customer-account/downloads",
      "<s-page",
      'inlineSize="large"',
    ]) {
      if (!extensionSource.includes(marker)) {
        fail(`customer-account extension source is missing ${marker}.`);
      }
    }
  }
}

if (failed) process.exit(1);

console.log(
  coreOnly
    ? "ReleaseCore purchased-music core validation passed."
    : "ReleaseCore purchased-music validation passed.",
);
