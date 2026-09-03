import { normalizeShopifyDigitalProduct } from "./shopify-products.server";
import db from "../db.server";
import { publicError } from "./http-security.server";

const VALID_TYPES = new Set(["SINGLE", "EP", "ALBUM"]);

function clean(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function metafieldMap(product) {
  const map = new Map();
  for (const item of product?.metafields?.nodes || []) {
    map.set(`${item.namespace}.${item.key}`, item);
  }
  return map;
}

function mf(map, namespace, key) {
  return map.get(`${namespace}.${key}`) || null;
}

function mfText(map, namespace, key) {
  const item = mf(map, namespace, key);
  if (!item) return "";
  if (typeof item.jsonValue === "string") return clean(item.jsonValue);
  return clean(item.value);
}

function mfList(map, namespace, key) {
  const item = mf(map, namespace, key);
  if (!item) return [];
  if (Array.isArray(item.jsonValue)) return item.jsonValue.map(clean).filter(Boolean);
  const raw = clean(item.value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(clean).filter(Boolean);
  } catch {
    // Fall back to legacy comma-separated metafield values.
  }
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function booleanValue(value) {
  const normalized = clean(value).toLowerCase();
  return ["true", "1", "yes", "explicit"].includes(normalized);
}

function dateValue(...values) {
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function filenameFromUrl(url, fallback) {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return name || fallback;
  } catch {
    return fallback;
  }
}

async function queryShopifyProduct(admin, productId) {
  const response = await admin.graphql(
    `#graphql
      query ReleaseCoreImportProduct($id: ID!) {
        product(id: $id) {
          id
          handle
          title
          vendor
          productType
          status
          publishedAt
          createdAt
          descriptionHtml
          featuredMedia {
            __typename
            ... on MediaImage {
              id
              image { url altText width height }
            }
          }
          variants(first: 1) {
            nodes {
              id
              sku
              barcode
              price
            }
          }
          metafields(first: 100) {
            nodes { namespace key type value jsonValue }
          }
        }
      }`,
    { variables: { id: productId } },
  );
  const json = await response.json();
  const errors = json?.errors || [];
  if (errors.length) throw new Error(errors.map((item) => item.message).join(" "));
  return json?.data?.product || null;
}

async function findOrCreateArtist(shop, name) {
  const artistName = clean(name) || "Artist not set";
  let artist = await db.artist.findFirst({ where: { shop, name: artistName } });
  if (!artist) artist = await db.artist.create({ data: { shop, name: artistName } });
  return artist;
}

async function safeIdentifiers({ shop, upc, catalogNumber, isrc }) {
  const warnings = [];
  let safeUpc = clean(upc) || null;
  let safeCatalog = clean(catalogNumber) || null;
  let safeIsrc = clean(isrc).replace(/[-\s]/g, "").toUpperCase() || null;

  if (safeUpc) {
    const existing = await db.release.findFirst({ where: { upc: safeUpc } });
    if (existing) {
      warnings.push(`UPC ${safeUpc} is already assigned to another ReleaseCore release and was not imported.`);
      safeUpc = null;
    }
  }
  if (safeCatalog) {
    const existing = await db.release.findFirst({ where: { shop, catalogNumber: safeCatalog } });
    if (existing) {
      warnings.push(`Catalog number ${safeCatalog} is already assigned in ReleaseCore and was not imported.`);
      safeCatalog = null;
    }
  }
  if (safeIsrc) {
    const existing = await db.track.findFirst({ where: { isrc: safeIsrc } });
    if (existing) {
      warnings.push(`ISRC ${safeIsrc} is already assigned to another ReleaseCore track and was not imported.`);
      safeIsrc = null;
    }
  }
  return { upc: safeUpc, catalogNumber: safeCatalog, isrc: safeIsrc, warnings };
}

export async function importShopifyProductAsRelease({ admin, shop, productId, requestedType = "AUTO", importState = "CATALOG", titleOverride = "", artistOverride = "" }) {
  if (!admin) throw new Error("Shopify Admin API is unavailable.");
  if (!productId?.startsWith("gid://shopify/Product/")) throw publicError("Choose a Shopify product to import.", { status: 400 });

  const existingRelease = await db.release.findFirst({
    where: {
      shop,
      OR: [
        { shopifyReleaseProductId: productId },
        { tracks: { some: { shopifyProductId: productId } } },
      ],
    },
  });
  if (existingRelease) {
    return { imported: false, existing: true, releaseId: existingRelease.id, warnings: ["This Shopify product is already connected to ReleaseCore."] };
  }

  const product = await queryShopifyProduct(admin, productId);
  if (!product) throw publicError("Shopify product not found.", { status: 404 });

  const fields = metafieldMap(product);
  const variant = product.variants?.nodes?.[0] || {};
  const detectedType = clean(mfText(fields, "releasecore", "release_type")).toUpperCase();
  const type = requestedType === "AUTO"
    ? (VALID_TYPES.has(detectedType) ? detectedType : "SINGLE")
    : clean(requestedType).toUpperCase();
  if (!VALID_TYPES.has(type)) throw publicError("Choose Single, EP or Album.", { status: 400 });

  const settings = await db.appSettings.findUnique({ where: { shop } });
  const title = clean(titleOverride) || mfText(fields, "releasecore", "release_title") || clean(product.title) || "Imported Release";
  const primaryArtistName = clean(artistOverride)
    || mfText(fields, "releasecore", "primary_artist")
    || mfText(fields, "custom", "artist_primary")
    || clean(product.vendor)
    || "Artist not set";
  const featuredArtists = [
    ...mfList(fields, "releasecore", "featured_artists"),
    ...mfList(fields, "custom", "artist_featured"),
  ].filter((value, index, array) => value && array.indexOf(value) === index && value !== primaryArtistName);

  const importedIds = await safeIdentifiers({
    shop,
    upc: mfText(fields, "releasecore", "upc") || mfText(fields, "custom", "upc") || variant.barcode,
    catalogNumber: mfText(fields, "releasecore", "catalog_number") || mfText(fields, "custom", "catalog_number") || variant.sku,
    isrc: mfText(fields, "releasecore", "isrc") || mfText(fields, "custom", "isrc"),
  });

  const releaseDate = dateValue(
    mfText(fields, "releasecore", "release_date"),
    mfText(fields, "custom", "release_date"),
    product.publishedAt,
  );
  const preSaveUrl = mfText(fields, "releasecore", "pre_save_url") || mfText(fields, "custom", "pre_save_url") || null;
  const streamingUrl = mfText(fields, "releasecore", "streaming_url") || mfText(fields, "custom", "streaming_url") || null;
  const primaryGenre = mfText(fields, "releasecore", "primary_genre") || mfText(fields, "custom", "primary_genre") || settings?.defaultGenre || null;
  const language = mfText(fields, "releasecore", "language") || mfText(fields, "custom", "primary_language") || settings?.defaultLanguage || null;
  const lyrics = mfText(fields, "releasecore", "lyrics") || mfText(fields, "custom", "lyrics") || null;
  const explicit = booleanValue(mfText(fields, "releasecore", "explicit") || mfText(fields, "custom", "parental_advisory"));
  const trackVersion = mfText(fields, "releasecore", "track_version") || null;
  const trackNumberRaw = Number(mfText(fields, "releasecore", "track_number") || mfText(fields, "custom", "track_album_order_number") || 1);
  const trackPosition = Number.isInteger(trackNumberRaw) && trackNumberRaw > 0 ? trackNumberRaw : 1;

  const isCatalog = importState !== "DRAFT";
  const now = new Date();
  const primaryArtist = await findOrCreateArtist(shop, primaryArtistName);
  const featuredRecords = [];
  for (const name of featuredArtists) featuredRecords.push(await findOrCreateArtist(shop, name));

  // RELEASECORE_M134_CATALOG_INTEGRITY
  // The import override is authoritative: keep ReleaseCore and Shopify aligned,
  // and ensure the source product cannot introduce physical shipping behavior.
  await normalizeShopifyDigitalProduct(admin, product.id, { title });

  const release = await db.release.create({
    data: {
      shop,
      type,
      title,
      artistName: primaryArtist.name,
      primaryGenre,
      releaseDate,
      preSaveUrl,
      streamingUrl,
      upc: importedIds.upc,
      upcAssignedAt: importedIds.upc ? now : null,
      catalogNumber: importedIds.catalogNumber,
      catalogNumberAssignedAt: importedIds.catalogNumber ? now : null,
      status: isCatalog ? "APPROVED" : "DRAFT",
      distributionStatus: isCatalog ? "DELIVERED" : "NOT_QUEUED",
      decisionAt: isCatalog ? now : null,
      distributionUpdatedAt: isCatalog ? now : null,
      ...(type === "SINGLE" ? {} : { shopifyReleaseProductId: product.id, shopifyReleaseProductHandle: product.handle }),
      artists: {
        create: [
          { artistId: primaryArtist.id, role: "PRIMARY", position: 1 },
          ...featuredRecords.map((artist, index) => ({ artistId: artist.id, role: "FEATURED", position: index + 1 })),
        ],
      },
    },
  });

  if (product.featuredMedia?.__typename === "MediaImage" && product.featuredMedia?.image?.url) {
    await db.releaseFile.create({
      data: {
        releaseId: release.id,
        kind: "COVER_ART",
        filename: filenameFromUrl(product.featuredMedia.image.url, `${title}-cover.jpg`),
        storageProvider: "SHOPIFY_PRODUCT_MEDIA",
        storageKey: product.featuredMedia.id,
        url: product.featuredMedia.image.url,
        mimeType: "image/*",
        status: "READY",
      },
    });
  }

  if (type === "SINGLE") {
    const track = await db.track.create({
      data: {
        releaseId: release.id,
        position: trackPosition,
        title,
        version: trackVersion,
        language,
        explicit,
        isrc: importedIds.isrc,
        isrcAssignedAt: importedIds.isrc ? now : null,
        lyrics,
        shopifyProductId: product.id,
        shopifyProductHandle: product.handle,
        artists: {
          create: [
            { artistId: primaryArtist.id, role: "PRIMARY", position: 1 },
            ...featuredRecords.map((artist, index) => ({ artistId: artist.id, role: "FEATURED", position: index + 1 })),
          ],
        },
      },
    });

    const roleMap = [
      ["releasecore", "songwriters", "SONGWRITER"],
      ["releasecore", "composers", "COMPOSER"],
      ["releasecore", "producers", "PRODUCER"],
      ["releasecore", "recording_engineers", "RECORDING_ENGINEER"],
      ["releasecore", "mixing_engineers", "MIXING_ENGINEER"],
      ["releasecore", "mastering_engineers", "MASTERING_ENGINEER"],
      ["releasecore", "cover_art_photographers", "COVER_ART_PHOTOGRAPHER"],
      ["releasecore", "cover_art_designers", "COVER_ART_DESIGNER"],
      ["custom", "song_producer", "PRODUCER"],
      ["custom", "recording_engineer", "RECORDING_ENGINEER"],
      ["custom", "mixing_engineer", "MIXING_ENGINEER"],
      ["custom", "mastering_engineer", "MASTERING_ENGINEER"],
      ["custom", "cover_art_photographer", "COVER_ART_PHOTOGRAPHER"],
      ["custom", "cover_art_designer", "COVER_ART_DESIGNER"],
    ];
    for (const [namespace, key, role] of roleMap) {
      const people = mfList(fields, namespace, key);
      if (!people.length) {
        const one = mfText(fields, namespace, key);
        if (one) people.push(one);
      }
      for (const personName of people) {
        const contributor = await db.contributor.findFirst({ where: { shop, legalName: personName } })
          || await db.contributor.create({ data: { shop, legalName: personName } });
        await db.trackCredit.upsert({
          where: { trackId_contributorId_role: { trackId: track.id, contributorId: contributor.id, role } },
          update: {},
          create: { trackId: track.id, contributorId: contributor.id, role },
        });
      }
    }
  }

  await db.submissionEvent.create({
    data: {
      releaseId: release.id,
      type: "IMPORTED_FROM_SHOPIFY",
      actorLabel: "ReleaseCore Admin",
      fromStatus: null,
      toStatus: release.status,
      message: `Imported from Shopify product ${product.title} (${product.id}).`,
    },
  });

  return {
    imported: true,
    existing: false,
    releaseId: release.id,
    product: { id: product.id, title: product.title, handle: product.handle },
    type,
    warnings: importedIds.warnings,
  };
}
