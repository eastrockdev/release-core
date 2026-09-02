const DEFINITIONS = [
  ["ReleaseCore Release ID", "release_id", "single_line_text_field"],
  ["Release Type", "release_type", "single_line_text_field"],
  ["Release Title", "release_title", "single_line_text_field"],
  ["Catalog Number", "catalog_number", "single_line_text_field"],
  ["Track Number", "track_number", "number_integer"],
  ["Track Version", "track_version", "single_line_text_field"],
  ["ISRC", "isrc", "single_line_text_field"],
  ["Release UPC", "upc", "single_line_text_field"],
  ["Release Date", "release_date", "date"],
  ["Primary Genre", "primary_genre", "single_line_text_field"],
  ["Track Language", "language", "single_line_text_field"],
  ["Explicit", "explicit", "boolean"],
  ["Parental Advisory", "parental_advisory", "single_line_text_field"],
  ["Primary Artist", "primary_artist", "single_line_text_field"],
  ["Featured Artists", "featured_artists", "list.single_line_text_field"],
  ["Label Name", "label_name", "single_line_text_field"],
  ["Copyright Holder", "copyright_holder", "single_line_text_field"],
  ["Lyrics", "lyrics", "multi_line_text_field"],
  ["Songwriters", "songwriters", "list.single_line_text_field"],
  ["Composers", "composers", "list.single_line_text_field"],
  ["Producers", "producers", "list.single_line_text_field"],
  ["Recording Engineers", "recording_engineers", "list.single_line_text_field"],
  ["Mixing Engineers", "mixing_engineers", "list.single_line_text_field"],
  ["Mastering Engineers", "mastering_engineers", "list.single_line_text_field"],
  ["Cover Art Photographers", "cover_art_photographers", "list.single_line_text_field"],
  ["Cover Art Designers", "cover_art_designers", "list.single_line_text_field"],
  ["Credits", "credits", "json"],
  ["Audio Preview", "audio_preview", "file_reference"],
  ["Distribution Status", "distribution_status", "single_line_text_field"],
];

export function releaseCoreMetafieldDefinitionCount() {
  return DEFINITIONS.length;
}

async function listDefinitions(admin) {
  const response = await admin.graphql(`#graphql
    query ReleaseCoreProductMetafieldDefinitions {
      metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "releasecore") {
        nodes { id name namespace key type { name } access { storefront } }
      }
    }`);
  const json = await response.json();
  return json?.data?.metafieldDefinitions?.nodes || [];
}

async function createDefinition(admin, [name, key, type]) {
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreMetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id key namespace type { name } access { storefront } }
        userErrors { field message code }
      }
    }`, { variables: { definition: { name, namespace: "releasecore", key, type, ownerType: "PRODUCT", description: `Created by ReleaseCore: ${name}`, access: { storefront: "PUBLIC_READ" } } } });
  const json = await response.json();
  const errors = json?.data?.metafieldDefinitionCreate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join(" "));
  return json?.data?.metafieldDefinitionCreate?.createdDefinition;
}

async function exposeDefinition(admin, key, name) {
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreMetafieldDefinitionUpdate($definition: MetafieldDefinitionUpdateInput!) {
      metafieldDefinitionUpdate(definition: $definition) {
        updatedDefinition { id key access { storefront } }
        userErrors { field message code }
      }
    }`, { variables: { definition: { namespace: "releasecore", key, ownerType: "PRODUCT", name, description: `Created by ReleaseCore: ${name}`, access: { storefront: "PUBLIC_READ" } } } });
  const json = await response.json();
  const errors = json?.data?.metafieldDefinitionUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join(" "));
}

export async function ensureReleaseCoreProductMetafields(admin) {
  const existing = await listDefinitions(admin);
  const byKey = new Map(existing.map((d) => [d.key, d]));
  const created = [];
  const repaired = [];
  const mismatched = [];

  for (const definition of DEFINITIONS) {
    const [name, key, type] = definition;
    const current = byKey.get(key);
    if (!current) {
      await createDefinition(admin, definition);
      created.push(key);
      continue;
    }
    if (current.type?.name !== type) {
      mismatched.push({ key, expected: type, actual: current.type?.name || "unknown" });
      continue;
    }
    if (current.access?.storefront !== "PUBLIC_READ" || current.name !== name) {
      await exposeDefinition(admin, key, name);
      repaired.push(key);
    }
  }

  return { total: DEFINITIONS.length, created, repaired, mismatched };
}

export async function getReleaseCoreMetafieldStatus(admin) {
  const existing = await listDefinitions(admin);
  const byKey = new Map(existing.map((d) => [d.key, d]));
  const missing = [];
  const mismatched = [];
  const hidden = [];
  for (const [, key, type] of DEFINITIONS) {
    const current = byKey.get(key);
    if (!current) { missing.push(key); continue; }
    if (current.type?.name !== type) mismatched.push({ key, expected: type, actual: current.type?.name || "unknown" });
    if (current.access?.storefront !== "PUBLIC_READ") hidden.push(key);
  }
  return { total: DEFINITIONS.length, installed: DEFINITIONS.length - missing.length, missing, mismatched, hidden };
}

function names(assignments, role) {
  return (assignments || []).filter((a) => a.role === role).map((a) => a.artist?.name).filter(Boolean);
}

function contributorNames(track, role) {
  return (track.credits || []).filter((c) => c.role === role).map((c) => c.contributor?.stageName || c.contributor?.legalName).filter(Boolean);
}

function creditsJson(track) {
  return (track.credits || []).map((c) => ({
    name: c.contributor?.stageName || c.contributor?.legalName || "Unknown contributor",
    legalName: c.contributor?.legalName || null,
    role: c.role,
    ownershipPercent: c.ownershipPercent,
    pro: c.contributor?.pro || null,
    ipi: c.contributor?.ipi || null,
    publisher: c.contributor?.publisherName || null,
  }));
}

function metafield(key, type, value) {
  if (value === null || value === undefined || value === "") return null;
  return { namespace: "releasecore", key, type, value: String(value) };
}

function listMetafield(key, values) {
  const clean = (values || []).filter(Boolean);
  return clean.length ? { namespace: "releasecore", key, type: "list.single_line_text_field", value: JSON.stringify(clean) } : null;
}

export function buildTrackProductMetafields({ release, track, settings }) {
  const primary = names(track.artists, "PRIMARY");
  const featured = names(track.artists, "FEATURED");
  return [
    metafield("release_id", "single_line_text_field", release.id),
    metafield("release_type", "single_line_text_field", release.type),
    metafield("release_title", "single_line_text_field", release.title),
    metafield("catalog_number", "single_line_text_field", release.catalogNumber),
    metafield("track_number", "number_integer", track.position),
    metafield("track_version", "single_line_text_field", track.version),
    metafield("isrc", "single_line_text_field", track.isrc),
    metafield("upc", "single_line_text_field", release.upc),
    metafield("release_date", "date", release.releaseDate ? new Date(release.releaseDate).toISOString().slice(0, 10) : null),
    metafield("primary_genre", "single_line_text_field", release.primaryGenre),
    metafield("language", "single_line_text_field", track.language),
    metafield("explicit", "boolean", track.explicit ? "true" : "false"),
    metafield("parental_advisory", "single_line_text_field", track.explicit ? "Explicit" : "Clean"),
    metafield("primary_artist", "single_line_text_field", primary.join(" & ") || release.artistName),
    listMetafield("featured_artists", featured),
    metafield("label_name", "single_line_text_field", settings?.defaultLabelName),
    metafield("copyright_holder", "single_line_text_field", settings?.defaultCopyrightHolder),
    metafield("lyrics", "multi_line_text_field", track.lyrics),
    listMetafield("songwriters", contributorNames(track, "SONGWRITER")),
    listMetafield("composers", contributorNames(track, "COMPOSER")),
    listMetafield("producers", contributorNames(track, "PRODUCER")),
    listMetafield("recording_engineers", contributorNames(track, "RECORDING_ENGINEER")),
    listMetafield("mixing_engineers", contributorNames(track, "MIXING_ENGINEER")),
    listMetafield("mastering_engineers", contributorNames(track, "MASTERING_ENGINEER")),
    listMetafield("cover_art_photographers", contributorNames(track, "COVER_ART_PHOTOGRAPHER")),
    listMetafield("cover_art_designers", contributorNames(track, "COVER_ART_DESIGNER")),
    { namespace: "releasecore", key: "credits", type: "json", value: JSON.stringify(creditsJson(track)) },
    metafield("audio_preview", "file_reference", (track.files || []).find((file) => file.kind === "PREVIEW_MP3" && file.storageKey)?.storageKey),
    metafield("distribution_status", "single_line_text_field", release.distributionStatus),
  ].filter(Boolean);
}

function trackVendor(release, track) {
  const primaryNames = names(track.artists, "PRIMARY");
  return primaryNames.join(" & ") || release.artistName || "Various Artists";
}

function trackTitle(track) {
  return `${track.title}${track.version ? ` (${track.version})` : ""}`;
}

export function trackSku(release, track) {
  if (!release.catalogNumber) return null;
  return release.type === "SINGLE" ? release.catalogNumber : `${release.catalogNumber}-T${String(track.position).padStart(2, "0")}`;
}

function trackBarcode(release) {
  // A UPC identifies a release. Do not duplicate an album/EP UPC across individual track products.
  return release.type === "SINGLE" && release.upc ? release.upc : null;
}

function productDescription(release, track) {
  const artist = trackVendor(release, track);
  const releaseDate = release.releaseDate ? new Date(release.releaseDate).toISOString().slice(0, 10) : null;
  const lines = [
    `<p>Digital music download of <strong>${trackTitle(track)}</strong> by ${artist}.</p>`,
    release.type !== "SINGLE" ? `<p>From the ${String(release.type).toLowerCase()} <strong>${release.title}</strong>.</p>` : "",
    releaseDate ? `<p>Release date: ${releaseDate}</p>` : "",
  ].filter(Boolean);
  return lines.join("");
}


async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveCoverFileId(admin, release) {
  const cover = (release.files || []).find(
    (file) => file.kind === "COVER_ART" && file.storageProvider === "SHOPIFY_FILES" && file.storageKey,
  );
  if (!cover) return null;

  // ReleaseCore stores the Shopify MediaImage GID in storageKey. Files are processed
  // asynchronously, and fileUpdate can only add product references after the file is READY.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await admin.graphql(`#graphql
      query ReleaseCoreCoverFileState($id: ID!) {
        node(id: $id) {
          ... on MediaImage {
            id
            fileStatus
            image { url width height }
          }
        }
      }
    `, { variables: { id: cover.storageKey } });
    const json = await response.json();
    const file = json?.data?.node;

    if (file?.id && file?.fileStatus === "READY") return file.id;

    if (file?.fileStatus === "FAILED") {
      console.warn("ReleaseCore: Shopify cover artwork processing failed", {
        releaseId: release.id,
        fileId: cover.storageKey,
      });
      return null;
    }

    if (attempt < 7) await sleep(500);
  }

  console.warn("ReleaseCore: cover artwork is still processing in Shopify Files", {
    releaseId: release.id,
    fileId: cover.storageKey,
  });
  return null;
}

async function attachCoverFileToProduct(admin, fileId, productId) {
  if (!fileId || !productId) return false;

  // Use Shopify Files' product-reference API instead of passing a MediaImage GID to
  // CreateMediaInput.originalSource. originalSource is URL-oriented in product media
  // mutations and can return "Image URL is invalid" when handed a GID.
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreAttachCoverFile($files: [FileUpdateInput!]!) {
      fileUpdate(files: $files) {
        files { id }
        userErrors { field message code }
      }
    }
  `, {
    variables: {
      files: [{ id: fileId, referencesToAdd: [productId] }],
    },
  });
  const json = await response.json();
  const errors = json?.data?.fileUpdate?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join(" "));
  }
  return true;
}

async function queryProduct(admin, id) {
  if (!id) return null;
  const response = await admin.graphql(`#graphql
    query ReleaseCoreProductState($id: ID!) {
      product(id: $id) {
        id handle
        media(first: 1) { nodes { id } }
        variants(first: 1) { nodes { id } }
      }
    }`, { variables: { id } });
  const json = await response.json();
  return json?.data?.product || null;
}

async function updateVariant(admin, productId, variantId, { price, barcode, sku }) {
  const variant = {
    id: variantId,
    inventoryItem: { requiresShipping: false, tracked: false, ...(sku ? { sku } : {}) },
  };
  if (price !== undefined && price !== null && Number.isFinite(Number(price))) variant.price = Number(price).toFixed(2);
  if (barcode) variant.barcode = barcode;
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreUpdateMusicVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price barcode }
        userErrors { field message }
      }
    }`, { variables: { productId, variants: [variant] } });
  const json = await response.json();
  const errors = json?.data?.productVariantsBulkUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join(" "));
}

export async function createTrackProduct({ admin, release, track, settings, price }) {
  const coverFileId = await resolveCoverFileId(admin, release);
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreCreateMusicProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id title handle variants(first: 1) { nodes { id } } }
        userErrors { field message }
      }
    }`, {
    variables: {
      product: {
        title: trackTitle(track),
        descriptionHtml: productDescription(release, track),
        vendor: trackVendor(release, track),
        productType: "Digital Music Download",
        category: "gid://shopify/TaxonomyCategory/me-3-1",
        status: "DRAFT",
        tags: ["ReleaseCore", "Digital Music", release.type, ...(release.catalogNumber ? [release.catalogNumber] : []), ...(track.isrc ? [track.isrc] : [])],
        metafields: buildTrackProductMetafields({ release, track, settings }),
      },
    },
  });
  const json = await response.json();
  const payload = json?.data?.productCreate;
  if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((e) => e.message).join(" "));
  const product = payload?.product;
  if (!product?.id) throw new Error("Shopify did not return the created product.");

  if (coverFileId) await attachCoverFileToProduct(admin, coverFileId, product.id);

  const variantId = product.variants?.nodes?.[0]?.id;
  if (variantId) await updateVariant(admin, product.id, variantId, { price, barcode: trackBarcode(release), sku: trackSku(release, track) });
  return product;
}

export async function syncTrackProduct({ admin, productId, release, track, settings, price }) {
  const current = await queryProduct(admin, productId);
  if (!current) return null;
  const coverFileId = !current.media?.nodes?.length ? await resolveCoverFileId(admin, release) : null;

  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreSyncMusicProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id handle }
        userErrors { field message }
      }
    }`, {
    variables: {
      product: {
        id: current.id,
        title: trackTitle(track),
        descriptionHtml: productDescription(release, track),
        vendor: trackVendor(release, track),
        productType: "Digital Music Download",
        category: "gid://shopify/TaxonomyCategory/me-3-1",
        tags: ["ReleaseCore", "Digital Music", release.type, ...(release.catalogNumber ? [release.catalogNumber] : []), ...(track.isrc ? [track.isrc] : [])],
        metafields: buildTrackProductMetafields({ release, track, settings }),
      },
    },
  });
  const json = await response.json();
  const payload = json?.data?.productUpdate;
  if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((e) => e.message).join(" "));

  if (coverFileId) await attachCoverFileToProduct(admin, coverFileId, current.id);

  const variantId = current.variants?.nodes?.[0]?.id;
  if (variantId) await updateVariant(admin, current.id, variantId, { price, barcode: trackBarcode(release), sku: trackSku(release, track) });
  return payload?.product || current;
}

export async function existingProductIds(admin, productIds) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const response = await admin.graphql(`#graphql
    query ReleaseCoreExistingProducts($ids: [ID!]!) {
      nodes(ids: $ids) { __typename ... on Product { id } }
    }`, { variables: { ids } });
  const json = await response.json();
  return (json?.data?.nodes || []).filter((node) => node?.__typename === "Product").map((node) => node.id);
}

export async function syncProductMetafieldSafely(admin, productIds, key, type, value) {
  const ids = await existingProductIds(admin, productIds);
  if (!ids.length) return { synced: 0, missing: (productIds || []).filter(Boolean).length };
  const metafields = ids.map((ownerId) => ({ ownerId, namespace: "releasecore", key, type, value: String(value ?? "") }));
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreSyncProductMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }`, { variables: { metafields } });
  const json = await response.json();
  const errors = json?.data?.metafieldsSet?.userErrors || [];
  if (errors.length) console.warn("ReleaseCore: product metafield sync warnings", errors);
  return { synced: ids.length, missing: Math.max(0, (productIds || []).filter(Boolean).length - ids.length), errors };
}
