import {
  DIGITAL_MUSIC_CATEGORY_ID,
  applyDefaultTrackPublication,
  normalizeTemplateSuffix,
  resolveShopifyMusicGenreMetafield,
} from "./shopify-catalog.server";
import { buildEastRockTrackProductMetafields } from "./east-rock-compatibility.server";

const DEFINITIONS = [
  ["ReleaseCore Track ID", "track_id", "single_line_text_field"],
  ["ReleaseCore Release ID", "release_id", "single_line_text_field"],
  ["Release Type", "release_type", "single_line_text_field"],
  ["Release Title", "release_title", "single_line_text_field"],
  ["Catalog Number", "catalog_number", "single_line_text_field"],
  ["Track Number", "track_number", "number_integer"],
  ["Track Version", "track_version", "single_line_text_field"],
  ["Track Count", "track_count", "number_integer"],
  ["Track Titles", "track_titles", "list.single_line_text_field"],
  ["ISRC", "isrc", "single_line_text_field"],
  ["Release UPC", "upc", "single_line_text_field"],
  ["Release Date", "release_date", "date"],
  ["Availability", "availability", "single_line_text_field"],
  ["Pre Order Enabled", "pre_order_enabled", "boolean"],
  ["Pre Order Date", "pre_order_date", "date"],
  ["Pre Order Audio Previews", "pre_order_audio_previews", "boolean"],
  ["Release Time Enabled", "release_time_enabled", "boolean"],
  ["Release Time", "release_time", "single_line_text_field"],
  ["Synchronous Release Unlocking", "synchronous_release_unlocking", "boolean"],
  ["Exclusive Window Enabled", "exclusive_enabled", "boolean"],
  ["Exclusive Partner", "exclusive_partner", "single_line_text_field"],
  ["Exclusive Period Weeks", "exclusive_period_weeks", "number_integer"],
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
  ["Cover Art Designers", "cover_art_designers", "list.single_line_text_field"],
  ["Credits", "credits", "json"],
  ["Audio Preview", "audio_preview", "file_reference"],
  ["Pre-save URL", "pre_save_url", "url"],
  ["Streaming URL", "streaming_url", "url"],
  ["Distribution Status", "distribution_status", "single_line_text_field"],
];

const LEGACY_DEFINITIONS = [
  ["Cover Art Photographers", "cover_art_photographers", "list.single_line_text_field"],
];

const DEFINITION_REPAIR_SET = [...DEFINITIONS, ...LEGACY_DEFINITIONS];
const MANAGED_KEYS = new Set(DEFINITIONS.map(([, key]) => key));
const CREDIT_FIELD_ROLES = [
  ["songwriters", "SONGWRITER"],
  ["composers", "COMPOSER"],
  ["producers", "PRODUCER"],
  ["recording_engineers", "RECORDING_ENGINEER"],
  ["mixing_engineers", "MIXING_ENGINEER"],
  ["mastering_engineers", "MASTERING_ENGINEER"],
  ["cover_art_designers", "COVER_ART_DESIGNER"],
];

function categoryConstraintPresent(definition) {
  if (definition?.constraints?.key !== "category") return false;
  return (definition.constraints?.values?.nodes || []).some((item) => {
    const value = String(item?.value || "");
    return value === DIGITAL_MUSIC_CATEGORY_ID || value === "me-3-1" || value.endsWith("/me-3-1");
  });
}

export function releaseCoreMetafieldDefinitionCount() {
  return DEFINITIONS.length;
}

async function listDefinitions(admin) {
  const response = await admin.graphql(`#graphql
    query ReleaseCoreProductMetafieldDefinitions {
      metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "releasecore") {
        nodes {
          id name namespace key
          type { name }
          access { storefront }
          constraints { key values(first: 25) { nodes { value } } }
        }
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
    }`, {
      variables: {
        definition: {
          name,
          namespace: "releasecore",
          key,
          type,
          ownerType: "PRODUCT",
          description: `Created by ReleaseCore: ${name}`,
          access: { storefront: "PUBLIC_READ" },
          constraints: { key: "category", values: [DIGITAL_MUSIC_CATEGORY_ID] },
        },
      },
    });
  const json = await response.json();
  const errors = json?.data?.metafieldDefinitionCreate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
  return json?.data?.metafieldDefinitionCreate?.createdDefinition;
}

async function repairDefinition(admin, definition, name) {
  const input = {
    namespace: "releasecore",
    key: definition.key,
    ownerType: "PRODUCT",
    name,
    description: `Created by ReleaseCore: ${name}`,
    access: { storefront: "PUBLIC_READ" },
  };
  if (!categoryConstraintPresent(definition)) {
    input.constraintsUpdates = {
      key: "category",
      values: [{ create: DIGITAL_MUSIC_CATEGORY_ID }],
    };
  }
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreMetafieldDefinitionUpdate($definition: MetafieldDefinitionUpdateInput!) {
      metafieldDefinitionUpdate(definition: $definition) {
        updatedDefinition { id key access { storefront } }
        userErrors { field message code }
      }
    }`, { variables: { definition: input } });
  const json = await response.json();
  const errors = json?.data?.metafieldDefinitionUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
}

export async function ensureReleaseCoreProductMetafields(admin) {
  const existing = await listDefinitions(admin);
  const byKey = new Map(existing.map((definition) => [definition.key, definition]));
  const created = [];
  const repaired = [];
  const mismatched = [];

  for (const definition of DEFINITION_REPAIR_SET) {
    const [name, key, type] = definition;
    const current = byKey.get(key);
    if (!current) {
      if (MANAGED_KEYS.has(key)) {
        await createDefinition(admin, definition);
        created.push(key);
      }
      continue;
    }
    if (current.type?.name !== type) {
      if (MANAGED_KEYS.has(key)) mismatched.push({ key, expected: type, actual: current.type?.name || "unknown" });
      continue;
    }
    if (current.access?.storefront !== "PUBLIC_READ" || current.name !== name || !categoryConstraintPresent(current)) {
      await repairDefinition(admin, current, name);
      repaired.push(key);
    }
  }

  return { total: DEFINITIONS.length, created, repaired, mismatched };
}

export async function getReleaseCoreMetafieldStatus(admin) {
  const existing = await listDefinitions(admin);
  const byKey = new Map(existing.map((definition) => [definition.key, definition]));
  const missing = [];
  const mismatched = [];
  const hidden = [];
  const unconstrained = [];
  for (const [, key, type] of DEFINITIONS) {
    const current = byKey.get(key);
    if (!current) { missing.push(key); continue; }
    if (current.type?.name !== type) mismatched.push({ key, expected: type, actual: current.type?.name || "unknown" });
    if (current.access?.storefront !== "PUBLIC_READ") hidden.push(key);
    if (!categoryConstraintPresent(current)) unconstrained.push(key);
  }
  return {
    total: DEFINITIONS.length,
    installed: DEFINITIONS.length - missing.length,
    missing,
    mismatched,
    hidden,
    unconstrained,
  };
}

function names(assignments, role) {
  return (assignments || []).filter((a) => a.role === role).map((a) => a.artist?.name).filter(Boolean);
}

function contributorNames(track, role) {
  return (track.credits || []).filter((c) => c.role === role).map((c) => c.contributor?.stageName || c.contributor?.legalName).filter(Boolean);
}

function creditRoleLabel(role) {
  return String(role || "Credit")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function creditsJson(track) {
  return (track.credits || []).map((credit) => ({
    name: credit.contributor?.stageName || credit.contributor?.legalName || "Unknown contributor",
    role: creditRoleLabel(credit.role),
  }));
}

function parseStringList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeCreditName(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function uniqueCreditNames(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const clean = String(value || "").trim();
    const normalized = normalizeCreditName(clean);
    if (!clean || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(clean);
  }
  return result;
}

function previousManagedCredits(currentMetafields) {
  const credits = (currentMetafields || []).find((item) => item?.namespace === "releasecore" && item?.key === "credits");
  if (!credits?.value) return { hasState: false, byRole: new Map() };
  try {
    const parsed = JSON.parse(credits.value);
    if (!Array.isArray(parsed)) return { hasState: false, byRole: new Map() };
    const byRole = new Map();
    for (const item of parsed) {
      const role = String(item?.role || "").trim();
      const name = String(item?.name || "").trim();
      if (!role || !name) continue;
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role).push(name);
    }
    return { hasState: true, byRole };
  } catch {
    return { hasState: false, byRole: new Map() };
  }
}

export function mergeMerchantCreditMetafields(currentMetafields, desiredMetafields) {
  const currentByKey = new Map((currentMetafields || [])
    .filter((item) => item?.namespace === "releasecore")
    .map((item) => [item.key, item]));
  const desiredByKey = new Map((desiredMetafields || [])
    .filter((item) => item?.namespace === "releasecore")
    .map((item) => [item.key, item]));
  const previous = previousManagedCredits(currentMetafields);

  for (const [key, role] of CREDIT_FIELD_ROLES) {
    const currentValues = parseStringList(currentByKey.get(key)?.value);
    const nextManagedValues = parseStringList(desiredByKey.get(key)?.value);
    const previousManagedValues = previous.hasState
      ? (previous.byRole.get(creditRoleLabel(role)) || [])
      : nextManagedValues;
    const previousManaged = new Set(previousManagedValues.map(normalizeCreditName));
    const merchantValues = currentValues.filter((value) => !previousManaged.has(normalizeCreditName(value)));
    const mergedValues = uniqueCreditNames([...merchantValues, ...nextManagedValues]);

    const existingIndex = desiredMetafields.findIndex((item) => item?.namespace === "releasecore" && item?.key === key);
    if (mergedValues.length) {
      const merged = {
        namespace: "releasecore",
        key,
        type: "list.single_line_text_field",
        value: JSON.stringify(mergedValues),
      };
      if (existingIndex >= 0) desiredMetafields[existingIndex] = merged;
      else desiredMetafields.push(merged);
    } else if (existingIndex >= 0) {
      desiredMetafields.splice(existingIndex, 1);
    }
  }

  return desiredMetafields;
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
    metafield("track_id", "single_line_text_field", track.id),
    metafield("release_id", "single_line_text_field", release.id),
    metafield("release_type", "single_line_text_field", release.type),
    metafield("release_title", "single_line_text_field", release.title),
    metafield("catalog_number", "single_line_text_field", release.catalogNumber),
    metafield("track_number", "number_integer", track.position),
    metafield("track_version", "single_line_text_field", track.version),
    metafield("isrc", "single_line_text_field", track.isrc),
    metafield("upc", "single_line_text_field", release.upc),
    metafield("release_date", "date", release.releaseDate ? new Date(release.releaseDate).toISOString().slice(0, 10) : null),
    metafield("availability", "single_line_text_field", release.availability || "ALL_CURRENT_FUTURE"),
    metafield("pre_order_enabled", "boolean", release.preOrderEnabled ? "true" : "false"),
    metafield("pre_order_date", "date", release.preOrderDate ? new Date(release.preOrderDate).toISOString().slice(0, 10) : null),
    metafield("pre_order_audio_previews", "boolean", release.preOrderAudioPreviews ? "true" : "false"),
    metafield("release_time_enabled", "boolean", release.releaseTimeEnabled ? "true" : "false"),
    metafield("release_time", "single_line_text_field", release.releaseTime),
    metafield("synchronous_release_unlocking", "boolean", release.synchronousReleaseUnlocking ? "true" : "false"),
    metafield("exclusive_enabled", "boolean", release.exclusiveEnabled ? "true" : "false"),
    metafield("exclusive_partner", "single_line_text_field", release.exclusivePartner),
    metafield("exclusive_period_weeks", "number_integer", release.exclusivePeriodWeeks),
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
    listMetafield("cover_art_designers", contributorNames(track, "COVER_ART_DESIGNER")),
    { namespace: "releasecore", key: "credits", type: "json", value: JSON.stringify(creditsJson(track)) },
    metafield("audio_preview", "file_reference", (track.files || []).find((file) => file.kind === "PREVIEW_MP3" && file.storageKey)?.storageKey),
    metafield("pre_save_url", "url", release.preSaveUrl),
    metafield("streaming_url", "url", release.streamingUrl),
    metafield("distribution_status", "single_line_text_field", release.distributionStatus),
    ...buildEastRockTrackProductMetafields({
      release,
      track,
      settings,
    }),
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

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function productDescription(release, track) {
  const artist = escapeHtml(trackVendor(release, track));
  const releaseDate = release.releaseDate ? new Date(release.releaseDate).toISOString().slice(0, 10) : null;
  const lines = [
    `<p>Digital music download of <strong>${escapeHtml(trackTitle(track))}</strong> by ${artist}.</p>`,
    release.type !== "SINGLE" ? `<p>From the ${escapeHtml(String(release.type).toLowerCase())} <strong>${escapeHtml(release.title)}</strong>.</p>` : "",
    releaseDate ? `<p>Release date: ${releaseDate}</p>` : "",
  ].filter(Boolean);
  return lines.join("");
}


async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveCoverFileId(admin, release) {
  // RELEASECORE_M134_CATALOG_INTEGRITY
  const cover = (release.files || []).find((file) => file.kind === "COVER_ART");
  if (!cover) return null;

  // Imported Shopify products retain a stable Shopify CDN URL. Reuse it when a
  // ReleaseCore-created parent/track product needs artwork.
  if (
    cover.storageProvider === "SHOPIFY_PRODUCT_MEDIA" &&
    /^https:\/\//i.test(String(cover.url || ""))
  ) {
    return String(cover.url);
  }

  if (cover.storageProvider !== "SHOPIFY_FILES" || !cover.storageKey) {
    return /^https:\/\//i.test(String(cover.url || "")) ? String(cover.url) : null;
  }

  // ReleaseCore cover uploads are Shopify MediaImage files. Wait until Shopify
  // finishes processing, then use the image URL as CreateMediaInput.originalSource.
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

    if (
      file?.fileStatus === "READY" &&
      /^https:\/\//i.test(String(file?.image?.url || ""))
    ) {
      return String(file.image.url);
    }

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

export async function attachCoverFileToProduct(admin, originalSource, productId) {
  if (!originalSource || !productId) return false;
  if (!/^https:\/\//i.test(String(originalSource))) {
    throw new Error("ReleaseCore could not attach cover artwork because Shopify did not return a usable image URL.");
  }

  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreAttachCoverMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
      productUpdate(product: $product, media: $media) {
        product {
          id
          media(first: 10) {
            nodes {
              id
              alt
              mediaContentType
              preview { status }
            }
          }
        }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      product: { id: productId },
      media: [{
        originalSource: String(originalSource),
        mediaContentType: "IMAGE",
        alt: "Release artwork",
      }],
    },
  });

  const json = await response.json();
  const errors = [
    ...(json?.errors || []).map((error) => String(error?.message || "").trim()).filter(Boolean),
    ...(json?.data?.productUpdate?.userErrors || [])
      .map((error) => String(error?.message || "").trim())
      .filter(Boolean),
  ];
  if (errors.length) throw new Error(errors.join(" "));

  return Boolean(json?.data?.productUpdate?.product?.id);
}

async function queryProduct(admin, id) {
  if (!id) return null;
  const response = await admin.graphql(`#graphql
    query ReleaseCoreProductState($id: ID!) {
      product(id: $id) {
        id handle status templateSuffix tags
        media(first: 20) { nodes { id } }
        variants(first: 1) { nodes { id } }
        metafields(first: 100, namespace: "releasecore") { nodes { id namespace key type value } }
      }
    }`, { variables: { id } });
  const json = await response.json();
  return json?.data?.product || null;
}

export async function updateVariant(admin, productId, variantId, { price, barcode, sku }) {
  const variant = {
    id: variantId,
    inventoryItem: {
      requiresShipping: false,
      tracked: false,
      measurement: { weight: { value: 0, unit: "GRAMS" } },
      ...(sku ? { sku } : {}),
    },
  };
  if (price !== undefined && price !== null && Number.isFinite(Number(price))) variant.price = Number(price).toFixed(2);
  variant.barcode = barcode || null;
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreUpdateMusicVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price barcode }
        userErrors { field message }
      }
    }`, { variables: { productId, variants: [variant] } });
  const json = await response.json();
  const errors = json?.data?.productVariantsBulkUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
}

export async function normalizeShopifyDigitalProduct(admin, productId, { title } = {}) {
  // RELEASECORE_M134_CATALOG_INTEGRITY
  if (!productId) throw new Error("A Shopify product ID is required.");

  const productInput = {
    id: productId,
    productType: "Digital Music Download",
    category: DIGITAL_MUSIC_CATEGORY_ID,
  };
  if (String(title || "").trim()) productInput.title = String(title).trim();

  const productResponse = await admin.graphql(`#graphql
    mutation ReleaseCoreNormalizeImportedProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id title productType }
        userErrors { field message }
      }
    }
  `, { variables: { product: productInput } });

  const productJson = await productResponse.json();
  const productErrors = [
    ...(productJson?.errors || []).map((error) => String(error?.message || "").trim()).filter(Boolean),
    ...(productJson?.data?.productUpdate?.userErrors || [])
      .map((error) => String(error?.message || "").trim())
      .filter(Boolean),
  ];
  if (productErrors.length) throw new Error(productErrors.join(" "));

  const variantIds = [];
  let after = null;

  for (;;) {
    const response = await admin.graphql(`#graphql
      query ReleaseCoreImportedProductVariants($id: ID!, $after: String) {
        product(id: $id) {
          id
          variants(first: 100, after: $after) {
            nodes { id }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `, { variables: { id: productId, after } });

    const json = await response.json();
    const gqlErrors = (json?.errors || [])
      .map((error) => String(error?.message || "").trim())
      .filter(Boolean);
    if (gqlErrors.length) throw new Error(gqlErrors.join(" "));

    const connection = json?.data?.product?.variants;
    if (!connection) throw new Error("Shopify could not reload the imported product variants.");

    variantIds.push(...(connection.nodes || []).map((variant) => variant?.id).filter(Boolean));
    if (!connection.pageInfo?.hasNextPage) break;

    after = connection.pageInfo?.endCursor;
    if (!after) throw new Error("Shopify returned an invalid product-variant pagination cursor.");
  }

  for (let offset = 0; offset < variantIds.length; offset += 100) {
    const chunk = variantIds.slice(offset, offset + 100).map((id) => ({
      id,
      inventoryItem: {
        requiresShipping: false,
        tracked: false,
        measurement: { weight: { value: 0, unit: "GRAMS" } },
      },
    }));

    const response = await admin.graphql(`#graphql
      mutation ReleaseCoreNormalizeImportedVariants(
        $productId: ID!,
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }
    `, { variables: { productId, variants: chunk } });

    const json = await response.json();
    const errors = [
      ...(json?.errors || []).map((error) => String(error?.message || "").trim()).filter(Boolean),
      ...(json?.data?.productVariantsBulkUpdate?.userErrors || [])
        .map((error) => String(error?.message || "").trim())
        .filter(Boolean),
    ];
    if (errors.length) throw new Error(errors.join(" "));
  }

  return {
    productId,
    title: productJson?.data?.productUpdate?.product?.title || String(title || "").trim() || null,
    variantsNormalized: variantIds.length,
  };
}

export async function tagsAdd(admin, productId, tags) {
  const clean = [...new Set((tags || []).filter(Boolean))];
  if (!clean.length) return;
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreAddProductTags($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
    }
  `, { variables: { id: productId, tags: clean } });
  const json = await response.json();
  const errors = json?.data?.tagsAdd?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
}

export async function deleteStaleReleaseCoreMetafields(admin, productId, currentMetafields, desiredMetafields) {
  const desiredKeys = new Set(desiredMetafields.filter((item) => item.namespace === "releasecore").map((item) => item.key));
  const stale = (currentMetafields || [])
    .filter((item) => item.namespace === "releasecore" && MANAGED_KEYS.has(item.key) && !desiredKeys.has(item.key))
    .map((item) => ({ ownerId: productId, namespace: "releasecore", key: item.key }));
  if (!stale.length) return 0;
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreDeleteStaleProductMetafields($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields { ownerId namespace key }
        userErrors { field message }
      }
    }
  `, { variables: { metafields: stale } });
  const json = await response.json();
  const errors = json?.data?.metafieldsDelete?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
  return stale.length;
}

async function productMetafields(admin, release, track, settings) {
  const fields = buildTrackProductMetafields({ release, track, settings });
  const genre = await resolveShopifyMusicGenreMetafield(admin, release.primaryGenre);
  if (genre) fields.push({ namespace: genre.namespace, key: genre.key, type: genre.type, value: genre.value });
  return fields;
}

function releaseCoreTags(release, track) {
  return [
    "ReleaseCore",
    "Digital Music",
    release.type,
    release.catalogNumber,
    track.isrc,
  ].filter(Boolean);
}

export async function createTrackProduct({ admin, release, track, settings, price, onCreated }) {
  const coverFileId = await resolveCoverFileId(admin, release);
  const metafields = await productMetafields(admin, release, track, settings);
  const defaultState = String(settings?.shopifyTrackProductDefaultState || "DRAFT").toUpperCase();
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreCreateMusicProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id title handle status templateSuffix variants(first: 1) { nodes { id } } }
        userErrors { field message }
      }
    }`, {
    variables: {
      product: {
        title: trackTitle(track),
        descriptionHtml: productDescription(release, track),
        vendor: trackVendor(release, track),
        productType: "Digital Music Download",
        category: DIGITAL_MUSIC_CATEGORY_ID,
        status: defaultState === "DRAFT" ? "DRAFT" : "ACTIVE",
        tags: releaseCoreTags(release, track),
        templateSuffix: normalizeTemplateSuffix(settings?.shopifySingleTemplateSuffix),
        metafields,
      },
    },
  });
  const json = await response.json();
  const payload = json?.data?.productCreate;
  if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((error) => error.message).join(" "));
  const product = payload?.product;
  if (!product?.id) throw new Error("Shopify did not return the created product.");

  if (onCreated) await onCreated(product);
  if (coverFileId) await attachCoverFileToProduct(admin, coverFileId, product.id);
  const variantId = product.variants?.nodes?.[0]?.id;
  if (variantId) await updateVariant(admin, product.id, variantId, { price, barcode: trackBarcode(release), sku: trackSku(release, track) });
  const publication = await applyDefaultTrackPublication({ admin, productId: product.id, release, settings });
  return { ...product, publication };
}

export async function syncTrackProduct({ admin, productId, release, track, settings, price }) {
  const current = await queryProduct(admin, productId);
  if (!current) return null;
  const coverFileId = !current.media?.nodes?.length ? await resolveCoverFileId(admin, release) : null;
  const metafields = mergeMerchantCreditMetafields(
    current.metafields?.nodes || [],
    await productMetafields(admin, release, track, settings),
  );

  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreSyncMusicProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id handle status templateSuffix }
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
        category: DIGITAL_MUSIC_CATEGORY_ID,
        metafields,
      },
    },
  });
  const json = await response.json();
  const payload = json?.data?.productUpdate;
  if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((error) => error.message).join(" "));

  await deleteStaleReleaseCoreMetafields(admin, current.id, current.metafields?.nodes || [], metafields);
  await tagsAdd(admin, current.id, releaseCoreTags(release, track));
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
  if (value === null || value === undefined || value === "") {
    const response = await admin.graphql(`#graphql
      mutation ReleaseCoreDeleteProductMetafields($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) { userErrors { field message } }
      }
    `, { variables: { metafields: ids.map((ownerId) => ({ ownerId, namespace: "releasecore", key })) } });
    const json = await response.json();
    const errors = json?.data?.metafieldsDelete?.userErrors || [];
    if (errors.length) console.warn("ReleaseCore: product metafield delete warnings", errors);
    return { synced: ids.length, missing: Math.max(0, (productIds || []).filter(Boolean).length - ids.length), errors };
  }
  const metafields = ids.map((ownerId) => ({ ownerId, namespace: "releasecore", key, type, value: String(value) }));
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreSyncProductMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }`, { variables: { metafields } });
  const json = await response.json();
  const errors = json?.data?.metafieldsSet?.userErrors || [];
  if (errors.length) console.warn("ReleaseCore: product metafield sync warnings", errors);
  return { synced: ids.length, missing: Math.max(0, (productIds || []).filter(Boolean).length - ids.length), errors };
}
