import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

function fail(message) {
  console.error(`ReleaseCore commerce validation failed: ${message}`);
  process.exitCode = 1;
}

for (const file of [
  "app/lib/commerce-entitlements.server.js",
  "app/lib/customer-downloads.server.js",
  "app/routes/webhooks.orders.paid.jsx",
  "app/routes/webhooks.orders.cancelled.jsx",
  "app/routes/webhooks.refunds.create.jsx",
  "prisma/migrations/20260902_m13_commerce_entitlements/migration.sql",
]) {
  if (!exists(file)) fail(`${file} is missing.`);
}

if (exists("app/lib/customer-downloads.server.js")) {
  const source = read("app/lib/customer-downloads.server.js");
  for (const marker of [
    '"CUSTOMER_MP3"',
    '"CUSTOMER_FLAC"',
    '"libmp3lame"',
    '"-id3v2_version"',
    '"-write_id3v1"',
    '"attached_pic"',
    "COVER_ART_PHOTOGRAPHER",
    "COVER_ART_DESIGNER",
    "CREDITS",
    "ARTIST_LINKS",
    "derivativeFingerprint",
    "prepareCustomerDownloadFilesForTracks",
  ]) {
    if (!source.includes(marker)) {
      fail(`customer download generator is missing ${marker}.`);
    }
  }
}

if (exists("app/lib/commerce-entitlements.server.js")) {
  const source = read("app/lib/commerce-entitlements.server.js");
  for (const marker of [
    "processPaidOrder",
    "processCancelledOrder",
    "processRefund",
    "salesLineItemGroupId",
    "BUNDLE_COMPONENT",
    "guestOrderAccessToken",
    "ensureCustomerDownloadFile",
    "formats:",
    "releaseFileId",
  ]) {
    if (!source.includes(marker)) fail(`commerce service is missing ${marker}.`);
  }
  if (source.includes('kind: "MASTER_WAV"')) {
    fail("buyer commerce delivery still directly resolves MASTER_WAV.");
  }
}

if (exists("prisma/schema.prisma")) {
  const source = read("prisma/schema.prisma");
  for (const marker of [
    "model CommerceOrder",
    "model CommerceEntitlement",
    "model CommerceDownload",
    "model CommerceWebhookEvent",
    "derivativeFingerprint",
    "customerDownloadsEnabled",
    "customerDownloadAutoGenerate",
    "customerDownloadMp3Enabled",
    "customerDownloadMp3BitrateKbps",
    "customerDownloadFlacEnabled",
    "customerDownloadFlacCompressionLevel",
    "customerDownloadEmbedArtwork",
    "customerDownloadEmbedLyrics",
    "customerDownloadEmbedCredits",
    "customerDownloadEmbedArtistLinks",
    "releaseFileId",
    "@@index([trackId, kind])",
  ]) {
    if (!source.includes(marker)) fail(`Prisma schema is missing ${marker}.`);
  }
}

if (exists("app/lib/storage.server.js")) {
  const source = read("app/lib/storage.server.js");
  for (const marker of [
    "saveCustomerDerivativeFile",
    "deleteCustomerDerivativeFile",
    '"customer-downloads"',
    'disposition = "inline"',
  ]) {
    if (!source.includes(marker)) {
      fail(`private derivative storage is missing ${marker}.`);
    }
  }
}

if (exists("app/routes/releasecore-proxy.$.jsx")) {
  const source = read("app/routes/releasecore-proxy.$.jsx");
  for (const marker of [
    'path === "downloads"',
    'path.match(/^downloads\\/([^/]+)\\/file$/)',
    'identity.url.searchParams.get("format")',
    "releaseFileId: file.id",
    'disposition: "attachment"',
  ]) {
    if (!source.includes(marker)) {
      fail(`app proxy derivative delivery is missing ${marker}.`);
    }
  }
  if (source.includes("master.storageProvider")) {
    fail("buyer app-proxy helper still directly serves a master file.");
  }
}

if (exists("app/routes/app.settings_.preferences.jsx")) {
  const source = read("app/routes/app.settings_.preferences.jsx");
  for (const marker of [
    'title="Customer download files"',
    "MP3 download bitrate",
    "FLAC compression level",
    "Embed cover artwork",
    "Embed lyrics",
    "Embed public credits",
    "Embed public artist links",
  ]) {
    if (!source.includes(marker)) fail(`Settings UI is missing ${marker}.`);
  }
}

for (const configFile of ["shopify.app.toml", "shopify.app.releasecore.toml"]) {
  if (!exists(configFile)) {
    fail(`${configFile} is missing.`);
    continue;
  }
  const source = read(configFile);
  for (const marker of [
    "read_orders",
    'uri = "/webhooks/orders/paid"',
    'topics = [ "orders/paid" ]',
    'uri = "/webhooks/orders/cancelled"',
    'topics = [ "orders/cancelled" ]',
    'uri = "/webhooks/refunds/create"',
    'topics = [ "refunds/create" ]',
  ]) {
    if (!source.includes(marker)) fail(`${configFile} is missing ${marker}.`);
  }
}

if (
  exists("shopify.app.toml") &&
  exists("shopify.app.releasecore.toml") &&
  read("shopify.app.toml") !== read("shopify.app.releasecore.toml")
) {
  fail("Shopify app configurations drifted.");
}

if (!process.exitCode) console.log("ReleaseCore commerce validation passed.");
