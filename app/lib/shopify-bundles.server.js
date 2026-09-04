import { creditRoleLabel } from "./releasecore";
import { shopifyMutationError } from "./operational-errors";
import {
  applyDefaultAlbumPublication,
  DIGITAL_MUSIC_CATEGORY_ID,
  normalizeTemplateSuffix,
  resolveShopifyMusicGenreMetafield,
} from "./shopify-catalog.server";
import {
  attachCoverFileToProduct,
  deleteStaleReleaseCoreMetafields,
  escapeHtml,
  mergeMerchantCreditMetafields,
  resolveCoverFileId,
  tagsAdd,
  updateVariant,
} from "./shopify-products.server";

export const SHOPIFY_FIXED_BUNDLE_COMPONENT_LIMIT = 30;

const CREDIT_ROLES = [
  ["songwriters", "SONGWRITER"],
  ["composers", "COMPOSER"],
  ["producers", "PRODUCER"],
  ["recording_engineers", "RECORDING_ENGINEER"],
  ["mixing_engineers", "MIXING_ENGINEER"],
  ["mastering_engineers", "MASTERING_ENGINEER"],
  ["cover_art_designers", "COVER_ART_DESIGNER"],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function metafield(key, type, value) {
  if (value === null || value === undefined || value === "") return null;
  return { namespace: "releasecore", key, type, value: String(value) };
}

function listMetafield(key, values) {
  const clean = uniqueStrings(values);
  return clean.length
    ? { namespace: "releasecore", key, type: "list.single_line_text_field", value: JSON.stringify(clean) }
    : null;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const clean = String(value || "").trim();
    const key = clean.toLocaleLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function assignmentNames(assignments, role) {
  return (assignments || [])
    .filter((assignment) => assignment.role === role)
    .map((assignment) => assignment.artist?.name)
    .filter(Boolean);
}

function contributorName(credit) {
  return credit?.contributor?.stageName || credit?.contributor?.legalName || null;
}

function contributorNames(release, role) {
  return uniqueStrings(
    (release.tracks || []).flatMap((track) =>
      (track.credits || [])
        .filter((credit) => credit.role === role)
        .map(contributorName)
        .filter(Boolean),
    ),
  );
}

function creditsJson(release) {
  const seen = new Set();
  const result = [];
  for (const track of release.tracks || []) {
    for (const credit of track.credits || []) {
      const name = contributorName(credit);
      if (!name) continue;
      const role = creditRoleLabel(credit.role);
      const key = `${name.toLocaleLowerCase()}|${role.toLocaleLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ name, role });
    }
  }
  return result;
}

function releaseArtist(release) {
  const primary = assignmentNames(release.artists, "PRIMARY");
  return primary.join(" & ") || release.artistName || "Various Artists";
}

function releaseFeaturedArtists(release) {
  return assignmentNames(release.artists, "FEATURED");
}

function releaseTypeLabel(release) {
  return String(release.type || "ALBUM").toUpperCase() === "EP" ? "EP" : "Album";
}

function releaseDescription(release) {
  const type = releaseTypeLabel(release);
  const artist = escapeHtml(releaseArtist(release));
  const title = escapeHtml(release.title || "Untitled Release");
  const releaseDate = release.releaseDate ? new Date(release.releaseDate).toISOString().slice(0, 10) : null;
  const tracks = (release.tracks || []).map((track) => {
    const version = track.version ? ` (${escapeHtml(track.version)})` : "";
    return `<li>${escapeHtml(track.title)}${version}</li>`;
  });
  return [
    `<p>Digital ${type.toLocaleLowerCase()} download of <strong>${title}</strong> by ${artist}.</p>`,
    releaseDate ? `<p>Release date: ${releaseDate}</p>` : "",
    tracks.length ? `<ol>${tracks.join("")}</ol>` : "",
  ].filter(Boolean).join("");
}

function releaseTags(release) {
  return [
    "ReleaseCore",
    "Digital Music",
    releaseTypeLabel(release),
    release.catalogNumber,
    release.upc,
  ].filter(Boolean);
}

function releaseProductType(release) {
  return String(release.type || "ALBUM").toUpperCase() === "EP" ? "Digital EP" : "Digital Album";
}

function trackTitles(release) {
  return (release.tracks || []).map((track) => `${track.title}${track.version ? ` (${track.version})` : ""}`);
}

export function buildReleaseProductMetafields({ release, settings }) {
  const primaryArtist = releaseArtist(release);
  const featuredArtists = releaseFeaturedArtists(release);
  const anyExplicit = (release.tracks || []).some((track) => track.explicit);
  const fields = [
    metafield("release_id", "single_line_text_field", release.id),
    metafield("release_type", "single_line_text_field", release.type),
    metafield("release_title", "single_line_text_field", release.title),
    metafield("catalog_number", "single_line_text_field", release.catalogNumber),
    metafield("track_count", "number_integer", (release.tracks || []).length),
    listMetafield("track_titles", trackTitles(release)),
    metafield("upc", "single_line_text_field", release.upc),
    metafield("release_date", "date", release.releaseDate ? new Date(release.releaseDate).toISOString().slice(0, 10) : null),
    metafield("primary_genre", "single_line_text_field", release.primaryGenre),
    metafield("explicit", "boolean", anyExplicit ? "true" : "false"),
    metafield("parental_advisory", "single_line_text_field", anyExplicit ? "Explicit" : "Clean"),
    metafield("primary_artist", "single_line_text_field", primaryArtist),
    listMetafield("featured_artists", featuredArtists),
    metafield("label_name", "single_line_text_field", settings?.defaultLabelName),
    metafield("copyright_holder", "single_line_text_field", settings?.defaultCopyrightHolder),
    ...CREDIT_ROLES.map(([key, role]) => listMetafield(key, contributorNames(release, role))),
    { namespace: "releasecore", key: "credits", type: "json", value: JSON.stringify(creditsJson(release)) },
    metafield("pre_save_url", "url", release.preSaveUrl),
    metafield("streaming_url", "url", release.streamingUrl),
    metafield("distribution_status", "single_line_text_field", release.distributionStatus),
  ].filter(Boolean);
  return fields;
}

async function releaseProductMetafields(admin, release, settings) {
  const fields = buildReleaseProductMetafields({ release, settings });
  const genre = await resolveShopifyMusicGenreMetafield(admin, release.primaryGenre);
  if (genre) fields.push({ namespace: genre.namespace, key: genre.key, type: genre.type, value: genre.value });
  return fields;
}

async function queryReleaseProduct(admin, productId) {
  if (!productId) return null;
  const response = await admin.graphql(`#graphql
    query ReleaseCoreBundleProduct($id: ID!) {
      product(id: $id) {
        id handle title status templateSuffix tags
        media(first: 20) { nodes { id } }
        metafields(first: 100, namespace: "releasecore") { nodes { id namespace key type value } }
        variants(first: 1) {
          nodes {
            id
            requiresComponents
            productVariantComponents(first: 50) {
              nodes { quantity productVariant { id product { id } } }
            }
          }
        }
      }
    }
  `, { variables: { id: productId } });
  const json = await response.json();
  return json?.data?.product || null;
}

function bundleComponents(release) {
  return (release.tracks || []).map((track) => ({
    productId: track.shopifyProductId,
    quantity: 1,
    // ReleaseCore track products are deliberately single-variant. Shopify still
    // requires this array in ProductBundleComponentInput, but there are no
    // buyer-selectable component options to project onto the album parent.
    optionSelections: [],
  }));
}

async function validateSingleVariantComponents(admin, release) {
  const ids = uniqueStrings((release.tracks || []).map((track) => track.shopifyProductId));
  if (!ids.length) return;
  const response = await admin.graphql(`#graphql
    query ReleaseCoreBundleComponentProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          variants(first: 2) { nodes { id title requiresComponents } }
        }
      }
    }
  `, { variables: { ids } });
  const json = await response.json();
  const products = (json?.data?.nodes || []).filter(Boolean);
  const found = new Set(products.map((product) => product.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new Error(`${missing.length} linked track product${missing.length === 1 ? " no longer exists" : "s no longer exist"} in Shopify. Sync the track products before creating the Album/EP bundle.`);
  }
  const nestedBundles = products.filter((product) => (product.variants?.nodes || []).some((variant) => variant.requiresComponents));
  if (nestedBundles.length) {
    const names = nestedBundles.slice(0, 3).map((product) => product.title).join(", ");
    const suffix = nestedBundles.length > 3 ? ` and ${nestedBundles.length - 3} more` : "";
    throw new Error(`Shopify does not support nested bundles. ${names}${suffix} must be regular track products before they can be Album/EP components.`);
  }
  const multiVariant = products.filter((product) => (product.variants?.nodes || []).length > 1);
  if (multiVariant.length) {
    const names = multiVariant.slice(0, 3).map((product) => product.title).join(", ");
    const suffix = multiVariant.length > 3 ? ` and ${multiVariant.length - 3} more` : "";
    throw new Error(`Album/EP bundle components must remain single-variant digital track products. Remove extra Shopify variants from ${names}${suffix}, then sync again.`);
  }

  const zeroVariant = products.filter((product) => !(product.variants?.nodes || []).length);
  if (zeroVariant.length) {
    const names = zeroVariant.slice(0, 3).map((product) => product.title).join(", ");
    throw new Error(`Shopify returned no sellable variant for ${names}. Re-sync the affected track product before creating the Album/EP bundle.`);
  }

  return products;
}

const RELEASECORE_VARIANT_BUNDLE_TAG = "ReleaseCoreVariantBundle";

function variantBundleError(message) {
  const error = new Error(String(message || "Shopify could not update the Album/EP bundle."));
  error.name = "ReleaseCoreBundleError";
  error.status = 409;
  error.expose = true;
  return error;
}

function graphqlMessages(json) {
  return (json?.errors || [])
    .map((error) => String(error?.message || "").trim())
    .filter(Boolean);
}


export async function getShopifyBundleReadiness(admin) {
  const response = await admin.graphql(`#graphql
    query ReleaseCoreBundleReadiness {
      shop {
        features {
          bundles {
            eligibleForBundles
            ineligibilityReason
            sellsBundles
          }
        }
      }
    }
  `);

  const json = await response.json();
  const queryErrors = graphqlMessages(json);
  if (queryErrors.length) {
    return {
      eligibleForBundles: false,
      sellsBundles: false,
      ineligibilityReason: `Shopify bundle readiness check failed: ${queryErrors.join(" ")}`,
    };
  }

  const bundles = json?.data?.shop?.features?.bundles;
  if (!bundles) {
    return {
      eligibleForBundles: false,
      sellsBundles: false,
      ineligibilityReason: "Shopify did not return bundle feature availability for this store.",
    };
  }

  return {
    eligibleForBundles: bundles.eligibleForBundles === true,
    sellsBundles: bundles.sellsBundles === true,
    ineligibilityReason: bundles.ineligibilityReason
      ? String(bundles.ineligibilityReason)
      : null,
  };
}

function isReleaseCoreVariantBundle(product) {
  return (product?.tags || []).includes(RELEASECORE_VARIANT_BUNDLE_TAG);
}

async function markReleaseCoreVariantBundle(admin, productId) {
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreMarkVariantBundle($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }
  `, {
    variables: { id: productId, tags: [RELEASECORE_VARIANT_BUNDLE_TAG] },
  });

  const json = await response.json();
  const messages = [
    ...graphqlMessages(json),
    ...(json?.data?.tagsAdd?.userErrors || [])
      .map((error) => String(error?.message || "").trim())
      .filter(Boolean),
  ];

  if (messages.length) {
    throw variantBundleError(`Shopify could not prepare the Album/EP bundle parent: ${messages.join(" ")}`);
  }
}

async function desiredVariantBundleComponents(admin, release) {
  const products = await validateSingleVariantComponents(admin, release);
  const productsById = new Map(products.map((product) => [product.id, product]));

  return (release.tracks || []).map((track) => {
    const product = productsById.get(track.shopifyProductId);
    const variantId = product?.variants?.nodes?.[0]?.id;
    if (!variantId) {
      throw variantBundleError(
        `Shopify could not resolve the single variant for "${track.title || "a track"}". Re-sync that track product and try again.`,
      );
    }
    return { id: variantId, quantity: 1 };
  });
}

async function syncReleaseCoreVariantBundle(admin, release, product) {
  const readiness = await getShopifyBundleReadiness(admin);
  if (!readiness.eligibleForBundles) {
    const reason = readiness.ineligibilityReason
      ? ` Shopify reports: ${readiness.ineligibilityReason}.`
      : "";
    throw variantBundleError(
      `Native Shopify bundles are not available on this store yet. ReleaseCore includes its own bundle integration; no additional Shopify Bundles app is required.${reason}`,
    );
  }

  const parentVariant = product?.variants?.nodes?.[0];
  if (!parentVariant?.id) {
    throw variantBundleError("Shopify did not return the Album/EP parent variant.");
  }

  const desired = await desiredVariantBundleComponents(admin, release);
  const desiredById = new Map(desired.map((item) => [item.id, item.quantity]));
  const existing = parentVariant.productVariantComponents?.nodes || [];
  const existingById = new Map(
    existing
      .filter((node) => node?.productVariant?.id)
      .map((node) => [node.productVariant.id, Number(node.quantity || 0)]),
  );

  const toCreate = desired.filter((item) => !existingById.has(item.id));
  const toUpdate = desired.filter(
    (item) => existingById.has(item.id) && existingById.get(item.id) !== item.quantity,
  );
  const toRemove = [...existingById.keys()].filter((id) => !desiredById.has(id));

  if (!toCreate.length && !toUpdate.length && !toRemove.length) return;

  const relationshipInput = { parentProductVariantId: parentVariant.id };
  if (toCreate.length) relationshipInput.productVariantRelationshipsToCreate = toCreate;
  if (toUpdate.length) relationshipInput.productVariantRelationshipsToUpdate = toUpdate;
  if (toRemove.length) relationshipInput.productVariantRelationshipsToRemove = toRemove;

  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreSyncVariantBundle($input: [ProductVariantRelationshipUpdateInput!]!) {
      productVariantRelationshipBulkUpdate(input: $input) {
        parentProductVariants {
          id
          requiresComponents
          productVariantComponents(first: 50) {
            nodes {
              quantity
              productVariant { id product { id } }
            }
          }
        }
        userErrors { code field message }
      }
    }
  `, { variables: { input: [relationshipInput] } });

  const json = await response.json();
  const messages = [
    ...graphqlMessages(json),
    ...(json?.data?.productVariantRelationshipBulkUpdate?.userErrors || [])
      .map((error) => String(error?.message || "").trim())
      .filter(Boolean),
  ];

  if (messages.length) {
    throw variantBundleError(`Shopify could not create the Album/EP fixed bundle: ${messages.join(" ")}`);
  }

  const updated = json?.data?.productVariantRelationshipBulkUpdate?.parentProductVariants?.[0];
  if (!updated?.id || updated.requiresComponents !== true) {
    throw variantBundleError("Shopify did not confirm the Album/EP parent as a fixed bundle.");
  }
}

function requireTrackProducts(release) {
  const missing = (release.tracks || []).filter((track) => !track.shopifyProductId);
  if (missing.length) {
    throw new Error(`${missing.length} track product${missing.length === 1 ? " is" : "s are"} missing. Sync the track products before creating the Album/EP product.`);
  }
}

async function startBundleUpdate(admin, productId, release) {
  requireTrackProducts(release);
  await validateSingleVariantComponents(admin, release);
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreUpdateFixedBundle($input: ProductBundleUpdateInput!) {
      productBundleUpdate(input: $input) {
        productBundleOperation { id status }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      input: {
        productId,
        title: release.title || "Untitled Release",
        components: bundleComponents(release),
      },
    },
  });
  const json = await response.json();
  const payload = json?.data?.productBundleUpdate;
  const errors = payload?.userErrors || [];
  if (errors.length) {
    throw shopifyMutationError(
      errors.map((error) => error.message).join(" "),
      errors,
      { status: 409 },
    );
  }
  if (!payload?.productBundleOperation?.id) throw new Error("Shopify did not start the fixed bundle update.");
  return payload.productBundleOperation;
}

export async function getBundleOperation(admin, operationId) {
  if (!operationId) return null;
  const response = await admin.graphql(`#graphql
    query ReleaseCoreBundleOperation($id: ID!) {
      productOperation(id: $id) {
        ... on ProductBundleOperation {
          id
          status
          product { id handle }
          userErrors { field message code }
        }
      }
    }
  `, { variables: { id: operationId } });
  const json = await response.json();
  return json?.data?.productOperation || null;
}

async function waitForBundleOperation(admin, operationId, { attempts = 24, delayMs = 400 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const operation = await getBundleOperation(admin, operationId);
    if (!operation) throw new Error("Shopify could not find the bundle operation.");
    if (operation.status === "COMPLETE") return operation;
    if (attempt < attempts - 1) await sleep(delayMs);
  }
  return { id: operationId, status: "PENDING", product: null, userErrors: [] };
}

function throwOperationErrors(operation) {
  const errors = operation?.userErrors || [];
  if (errors.length) {
    throw shopifyMutationError(
      errors.map((error) => error.message).join(" "),
      errors,
      { status: 409 },
    );
  }
}

async function updateReleaseProductMetadata({ admin, product, release, settings, price, assignTemplate = false }) {
  const desired = mergeMerchantCreditMetafields(
    product.metafields?.nodes || [],
    await releaseProductMetafields(admin, release, settings),
  );
  const productInput = {
    id: product.id,
    title: release.title || "Untitled Release",
    descriptionHtml: releaseDescription(release),
    vendor: releaseArtist(release),
    productType: releaseProductType(release),
    category: DIGITAL_MUSIC_CATEGORY_ID,
    metafields: desired,
  };
  if (assignTemplate) productInput.templateSuffix = normalizeTemplateSuffix(settings?.shopifyAlbumTemplateSuffix);

  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreSyncAlbumProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id handle status templateSuffix }
        userErrors { field message }
      }
    }
  `, { variables: { product: productInput } });
  const json = await response.json();
  const payload = json?.data?.productUpdate;
  const errors = payload?.userErrors || [];
  if (errors.length) {
    throw shopifyMutationError(
      errors.map((error) => error.message).join(" "),
      errors,
      { status: 409 },
    );
  }

  await deleteStaleReleaseCoreMetafields(admin, product.id, product.metafields?.nodes || [], desired);
  await tagsAdd(admin, product.id, releaseTags(release));
  if (!product.media?.nodes?.length) {
    const coverFileId = await resolveCoverFileId(admin, release);
    if (coverFileId) await attachCoverFileToProduct(admin, coverFileId, product.id);
  }
  const variantId = product.variants?.nodes?.[0]?.id;
  if (variantId) {
    await updateVariant(admin, product.id, variantId, {
      price,
      barcode: release.upc || null,
      sku: release.catalogNumber || null,
    });
  }
  return payload?.product || product;
}

async function createStandardFallbackProduct({ admin, release, settings, price, onCreated, claimBundleOwnership = false }) {
  const metafields = await releaseProductMetafields(admin, release, settings);
  const state = String(settings?.shopifyAlbumProductDefaultState || "DRAFT").toUpperCase();
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreCreateAlbumFallback($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id handle status templateSuffix
          media(first: 20) { nodes { id } }
          metafields(first: 100, namespace: "releasecore") { nodes { id namespace key type value } }
          variants(first: 1) { nodes { id requiresComponents } }
        }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      product: {
        title: release.title || "Untitled Release",
        ...(claimBundleOwnership ? { claimOwnership: { bundles: true } } : {}),
        descriptionHtml: releaseDescription(release),
        vendor: releaseArtist(release),
        productType: releaseProductType(release),
        category: DIGITAL_MUSIC_CATEGORY_ID,
        status: state === "DRAFT" ? "DRAFT" : "ACTIVE",
        tags: releaseTags(release),
        templateSuffix: normalizeTemplateSuffix(settings?.shopifyAlbumTemplateSuffix),
        metafields,
      },
    },
  });
  const json = await response.json();
  const payload = json?.data?.productCreate;
  const errors = payload?.userErrors || [];
  if (errors.length) {
    throw shopifyMutationError(
      errors.map((error) => error.message).join(" "),
      errors,
      { status: 409 },
    );
  }
  const product = payload?.product;
  if (!product?.id) throw new Error("Shopify did not return the Album/EP product.");
  if (onCreated) await onCreated(product);
  const coverFileId = await resolveCoverFileId(admin, release);
  if (coverFileId) await attachCoverFileToProduct(admin, coverFileId, product.id);
  const variantId = product.variants?.nodes?.[0]?.id;
  if (variantId) await updateVariant(admin, product.id, variantId, { price, barcode: release.upc || null, sku: release.catalogNumber || null });
  const publication = await applyDefaultAlbumPublication({ admin, productId: product.id, release, settings });
  return { product, mode: "STANDARD_OVER_LIMIT", publication };
}

export async function syncReleaseProduct({
  admin,
  release,
  settings,
  price,
  onOperationStarted,
  onOperationFinished,
  onProductResolved,
  onProductCreated,
}) {
  if (!release || !["ALBUM", "EP"].includes(String(release.type || "").toUpperCase())) {
    throw new Error("Only Album and EP releases use a release-level Shopify product.");
  }
  if (!(release.tracks || []).length) throw new Error("Add at least one track before creating the Album/EP product.");
  requireTrackProducts(release);

  let productId = release.shopifyReleaseProductId || null;
  let assignTemplate = false;
  let resumedBundleOperation = false;

  if (release.shopifyReleaseBundleOperationId) {
    const pending = await waitForBundleOperation(admin, release.shopifyReleaseBundleOperationId);
    if (pending.status !== "COMPLETE") {
      return { pending: true, operationId: release.shopifyReleaseBundleOperationId, mode: "BUNDLE" };
    }
    if (onOperationFinished) await onOperationFinished();
    throwOperationErrors(pending);
    if (!productId && pending.product?.id) {
      productId = pending.product.id;
      assignTemplate = true;
      if (onProductResolved) await onProductResolved(pending.product);
    }
    resumedBundleOperation = true;
  }

  let current = productId ? await queryReleaseProduct(admin, productId) : null;
  if (productId && !current) productId = null;

  const overLimit = release.tracks.length > SHOPIFY_FIXED_BUNDLE_COMPONENT_LIMIT;
  if (overLimit && current?.variants?.nodes?.[0]?.requiresComponents) {
    throw new Error(`This release now has ${release.tracks.length} tracks, but Shopify fixed bundles support up to ${SHOPIFY_FIXED_BUNDLE_COMPONENT_LIMIT} components. Reduce the track count before syncing this existing bundle.`);
  }

  if (!current && overLimit) {
    return createStandardFallbackProduct({
      admin,
      release,
      settings,
      price,
      onCreated: onProductCreated,
    });
  }

  if (!current) {
    // ReleaseCore track products are deterministic single-variant products.
    // Create one Album/EP parent variant, then attach each track variant
    // directly using Shopify's native variant fixed-bundle relationship API.
    const created = await createStandardFallbackProduct({
      admin,
      release,
      settings,
      price,
      onCreated: onProductCreated,
      claimBundleOwnership: true,
    });
    current = await queryReleaseProduct(admin, created.product?.id);
    if (!current) {
      throw variantBundleError("Shopify created the Album/EP parent product but ReleaseCore could not reload it.");
    }

    // Persist a retry marker before relationship creation. If Shopify rejects
    // bundle creation, the same parent can be retried instead of duplicated.
    await markReleaseCoreVariantBundle(admin, current.id);
    current = await queryReleaseProduct(admin, current.id) || current;

    await syncReleaseCoreVariantBundle(admin, release, current);
    current = await queryReleaseProduct(admin, current.id) || current;
    assignTemplate = false;
  } else if (isReleaseCoreVariantBundle(current) && !resumedBundleOperation) {
    await syncReleaseCoreVariantBundle(admin, release, current);
    current = await queryReleaseProduct(admin, current.id) || current;
  } else if (current.variants?.nodes?.[0]?.requiresComponents && !resumedBundleOperation) {
    // Keep legacy M12.2 product-level bundles compatible if one already exists.
    const operation = await startBundleUpdate(admin, current.id, release);
    if (onOperationStarted) await onOperationStarted(operation.id);
    const completed = await waitForBundleOperation(admin, operation.id);
    if (completed.status !== "COMPLETE") {
      return { pending: true, operationId: operation.id, product: current, mode: "BUNDLE" };
    }
    if (onOperationFinished) await onOperationFinished();
    throwOperationErrors(completed);
    current = await queryReleaseProduct(admin, current.id) || current;
  }

  const isBundle = Boolean(current.variants?.nodes?.[0]?.requiresComponents);
  const synced = await updateReleaseProductMetadata({
    admin,
    product: current,
    release,
    settings,
    price,
    assignTemplate,
  });
  let publication = null;
  if (assignTemplate) publication = await applyDefaultAlbumPublication({ admin, productId: current.id, release, settings });

  return {
    product: synced,
    mode: isBundle ? "BUNDLE" : "STANDARD_OVER_LIMIT",
    publication,
    warning: !isBundle && !overLimit
      ? "This existing release product is a standard product rather than a fixed bundle. ReleaseCore preserved it instead of replacing merchant catalog data automatically."
      : overLimit
        ? `Shopify fixed bundles support up to ${SHOPIFY_FIXED_BUNDLE_COMPONENT_LIMIT} components, so this release uses a standard Album/EP product without component relationships.`
        : null,
  };
}
