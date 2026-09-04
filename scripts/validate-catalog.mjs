#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const fail = (message) => {
  console.error(`ReleaseCore catalog validation failed: ${message}`);
  process.exitCode = 1;
};

for (const file of [
  "app/lib/shopify-catalog.server.js",
  "app/lib/shopify-products.server.js",
  "app/lib/shopify-bundles.server.js",
  "app/lib/shopify-artist-collections.server.js",
  "prisma/migrations/20260902_m12_track_catalog_foundations/migration.sql",
  "prisma/migrations/20260902_m12_album_bundle_products/migration.sql",
  "prisma/migrations/20260902_m13_artist_collections/migration.sql",
]) {
  if (!exists(file)) fail(`${file} is missing.`);
}

if (exists("app/lib/shopify-catalog.server.js")) {
  const source = read("app/lib/shopify-catalog.server.js");
  for (const marker of [
    'DIGITAL_MUSIC_CATEGORY_ID = "gid://shopify/TaxonomyCategory/me-3-1"',
    "publishablePublish",
    "publishableUnpublish",
    "resolveShopifyMusicGenreMetafield",
    'key: "music-genre"',
    'type: "list.metaobject_reference"',
    "metaobject_definition_id",
    "metaobjectCreate",
    "SCHEDULE_RELEASE_DATE",
  ]) {
    if (!source.includes(marker)) fail(`Shopify catalog service is missing ${marker}.`);
  }
  if (source.includes("product_taxonomy_value_reference") && source.includes("resolveShopifyMusicGenreMetafield")) {
    fail("Shopify Music genre resolver still uses the obsolete taxonomy-value metafield type instead of shopify.music-genre metaobjects.");
  }

}

if (exists("app/lib/shopify-products.server.js")) {
  const source = read("app/lib/shopify-products.server.js");
  for (const marker of [
    '"track_id"',
    '"pre_save_url"',
    '"streaming_url"',
    '"songwriters"',
    '"composers"',
    '"producers"',
    '"recording_engineers"',
    '"mixing_engineers"',
    '"mastering_engineers"',
    '"cover_art_designers"',
    "constraintsUpdates",
    "metafieldsDelete",
    "tagsAdd",
    "escapeHtml",
    "shopifySingleTemplateSuffix",
    "mergeMerchantCreditMetafields",
    "previousManagedCredits",
  ]) {
    if (!source.includes(marker)) fail(`Track product publisher is missing ${marker}.`);
  }
  if (/ownershipPercent|\bipi\b|\bipi\b/i.test(source.match(/function creditsJson[\s\S]*?\n}\n/)?.[0] || "")) {
    fail("public credits JSON still exposes rights-administration data.");
  }
  const createSection = source.slice(source.indexOf("export async function createTrackProduct"), source.indexOf("export async function syncTrackProduct"));
  const syncSection = source.slice(source.indexOf("export async function syncTrackProduct"));
  if (!createSection.includes("onCreated")) fail("track product creation must persist its Shopify link before follow-up work.");
  if (/\btags\s*:/.test(syncSection)) fail("track product synchronization must not overwrite the merchant's complete Shopify tag list.");
}

if (exists("app/lib/shopify-bundles.server.js")) {
  const source = read("app/lib/shopify-bundles.server.js");
  for (const marker of [
    "SHOPIFY_FIXED_BUNDLE_COMPONENT_LIMIT = 30",
    "productVariantRelationshipBulkUpdate",
    "productBundleUpdate",
    "productOperation",
    "ProductBundleOperation",
    "shopifyAlbumTemplateSuffix",
    "shopifyAlbumProductDefaultState",
    "buildReleaseProductMetafields",
    '"track_count"',
    '"track_titles"',
    "STANDARD_OVER_LIMIT",
  ]) {
    if (!source.includes(marker)) fail(`Album/EP bundle publisher is missing ${marker}.`);
  }
}


if (exists("app/lib/shopify-artist-collections.server.js")) {
  const source = read("app/lib/shopify-artist-collections.server.js");

  for (const marker of [
    "collectionCreate",
    "CollectionCreateInput",
    "collectionUpdate",
    "CollectionUpdateInput",
    "sourcesToCreate",
    "sourcesToUpdate",
    "selectionsToAdd",
    "selectionsToRemove",
    '"managed_product_ids"',
    "metafieldsSet",
    "previouslyManagedProductIds",
    "RELEASECORE_COLLECTION_SOURCE_TITLE",
    '"artist_profile"',
    "shopifyArtistCollectionTemplateSuffix",
  ]) {
    if (!source.includes(marker)) {
      fail(`Artist collection publisher is missing ${marker}.`);
    }
  }
}

for (const configFile of ["shopify.app.toml", "shopify.app.releasecore.toml"]) {
  if (!exists(configFile)) continue;
  const source = read(configFile);
  for (const scope of ["read_publications", "write_publications", "read_metaobject_definitions", "read_metaobjects"]) {
    if (!new RegExp(`\\b${scope}\\b`).test(source)) fail(`${configFile} is missing ${scope}.`);
  }
}

if (exists("prisma/schema.prisma")) {
  const schema = read("prisma/schema.prisma");
  for (const marker of [
    "preSaveUrl",
    "streamingUrl",
    "shopifyTrackProductDefaultState",
    "shopifyAlbumProductDefaultState",
    "shopifySingleTemplateSuffix",
    "shopifyAlbumTemplateSuffix",
    "shopifyArtistCollectionTemplateSuffix",
    "shopifyCollectionId",
    "shopifyCollectionHandle",
    "shopifyCollectionSourceId",
    "shopifyCollectionSyncedAt",
    "defaultAlbumPrice",
    "shopifyReleaseBundleOperationId",
  ]) {
    if (!schema.includes(marker)) fail(`Prisma schema is missing ${marker}.`);
  }
}

if (exists("app/routes/app.release.$releaseId.jsx")) {
  const source = read("app/routes/app.release.$releaseId.jsx");
  if (!source.includes('name="preSaveUrl"') || !source.includes('name="streamingUrl"')) {
    fail("release editor is missing pre-save/streaming URL controls.");
  }
}

if (exists("extensions/releasecore-artist-portal/assets/releasecore-portal.js")) {
  const source = read("extensions/releasecore-artist-portal/assets/releasecore-portal.js");
  if (!source.includes("release.preSaveUrl") || !source.includes("release.streamingUrl")) {
    fail("Artist Portal is missing release pre-save/streaming links.");
  }
}

if (exists("app/routes/app.settings_.preferences.jsx")) {
  const source = read("app/routes/app.settings_.preferences.jsx");
  for (const marker of ["New track product default", "New Album / EP product default", "Single-track product template", "Album / EP product template", "Artist collection template", "Default Album / EP price"]) {
    if (!source.includes(marker)) fail(`Release Preferences is missing ${marker}.`);
  }
}


if (exists("app/routes/app.artist.$artistId.jsx")) {
  const source = read("app/routes/app.artist.$artistId.jsx");

  for (const marker of [
    "Shopify artist collection",
    "Create artist collection",
    "Sync artist collection",
    "Link existing",
    "sync-shopify-collection",
    "link-shopify-collection",
    "unlink-shopify-collection",
  ]) {
    if (!source.includes(marker)) {
      fail(`Artist workspace is missing ${marker}.`);
    }
  }
}

if (exists("app/lib/distribution.server.js")) {
  const source = read("app/lib/distribution.server.js");
  for (const intent of ["publish-shopify-product", "schedule-shopify-product", "unpublish-shopify-product", "sync-shopify-release-product", "publish-shopify-release-product", "schedule-shopify-release-product", "unpublish-shopify-release-product"]) {
    if (!source.includes(intent)) fail(`Distribution workflow is missing ${intent}.`);
  }
}

if (!process.exitCode) console.log("ReleaseCore catalog validation passed.");
