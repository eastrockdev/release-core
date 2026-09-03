export const DIGITAL_MUSIC_CATEGORY_ID = "gid://shopify/TaxonomyCategory/me-3-1";

export const PRODUCT_DEFAULT_STATES = [
  "DRAFT",
  "ACTIVE_UNPUBLISHED",
  "PUBLISH_NOW",
  "SCHEDULE_RELEASE_DATE",
];

export const TRACK_PRODUCT_DEFAULT_STATES = PRODUCT_DEFAULT_STATES;
export const ALBUM_PRODUCT_DEFAULT_STATES = PRODUCT_DEFAULT_STATES;

const normalize = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const GENRE_ALIASES = {
  "alternative": ["alternative"],
  "blues": ["blues"],
  "children s music": ["children s", "children s music"],
  "christian gospel": ["religious", "christian", "gospel"],
  "classical": ["classic", "classical"],
  "comedy": ["comedy"],
  "country": ["country"],
  "dance": ["dance"],
  "electronic": ["electronic"],
  "electronic music": ["electronic"],
  "folk": ["folk"],
  "hip hop rap": ["hip hop", "rap"],
  "hip hop": ["hip hop"],
  "holiday": ["christmas", "holiday"],
  "jazz": ["jazz"],
  "latin": ["latin"],
  "metal": ["metal"],
  "new age": ["new age"],
  "pop": ["pop"],
  "punk": ["punk"],
  "r b soul": ["r b", "soul"],
  "r b": ["r b"],
  "reggae": ["reggae"],
  "rock": ["rock"],
  "singer songwriter": ["singer songwriter"],
  "soundtrack": ["soundtrack"],
  "spoken word": ["spoken word"],
  "world": ["world music", "world"],
  "world music": ["world music"],
};

export function normalizeTemplateSuffix(value) {
  const text = String(value || "").trim();
  if (!text || text === "default") return null;
  return text
    .replace(/^product\./i, "")
    .replace(/^collection\./i, "")
    .replace(/\.json$/i, "")
    .replace(/\.liquid$/i, "")
    .trim() || null;
}

function normalizeProductDefaultState(value) {
  const state = String(value || "DRAFT").trim().toUpperCase();
  return PRODUCT_DEFAULT_STATES.includes(state) ? state : "DRAFT";
}

export function normalizeTrackProductDefaultState(value) {
  return normalizeProductDefaultState(value);
}

export function normalizeAlbumProductDefaultState(value) {
  return normalizeProductDefaultState(value);
}

export async function getOnlineStorePublication(admin) {
  const response = await admin.graphql(`#graphql
    query ReleaseCoreOnlineStorePublication {
      publications(first: 50) {
        nodes { id name supportsFuturePublishing autoPublish }
      }
    }
  `);
  const json = await response.json();
  const publications = json?.data?.publications?.nodes || [];
  return publications.find((publication) => publication.name === "Online Store")
    || publications.find((publication) => publication.supportsFuturePublishing)
    || null;
}

async function updateProductStatus(admin, productId, status) {
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreUpdateProductStatus($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id status }
        userErrors { field message }
      }
    }
  `, { variables: { product: { id: productId, status } } });
  const json = await response.json();
  const errors = json?.data?.productUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
  return json?.data?.productUpdate?.product || null;
}

export async function publishProductToOnlineStore({ admin, productId, publishDate = null }) {
  const publication = await getOnlineStorePublication(admin);
  if (!publication) throw new Error("Shopify Online Store publication was not found for this store.");
  await updateProductStatus(admin, productId, "ACTIVE");
  const input = { publicationId: publication.id };
  if (publishDate) input.publishDate = new Date(publishDate).toISOString();
  const response = await admin.graphql(`#graphql
    mutation ReleaseCorePublishProduct($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }
  `, { variables: { id: productId, input: [input] } });
  const json = await response.json();
  const errors = json?.data?.publishablePublish?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
  return { publicationId: publication.id, publishDate: input.publishDate || null };
}

export async function unpublishProductFromOnlineStore({ admin, productId }) {
  const publication = await getOnlineStorePublication(admin);
  if (!publication) throw new Error("Shopify Online Store publication was not found for this store.");
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreUnpublishProduct($id: ID!, $input: [PublicationInput!]!) {
      publishableUnpublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }
  `, { variables: { id: productId, input: [{ publicationId: publication.id }] } });
  const json = await response.json();
  const errors = json?.data?.publishableUnpublish?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
  return { publicationId: publication.id };
}

async function applyDefaultProductPublication({ admin, productId, release, state }) {
  const normalized = normalizeProductDefaultState(state);
  if (normalized === "DRAFT") {
    await updateProductStatus(admin, productId, "DRAFT");
    return { state: "DRAFT" };
  }
  if (normalized === "ACTIVE_UNPUBLISHED") {
    await updateProductStatus(admin, productId, "ACTIVE");
    return { state: "ACTIVE_UNPUBLISHED" };
  }
  if (normalized === "PUBLISH_NOW") {
    await publishProductToOnlineStore({ admin, productId });
    return { state: "PUBLISHED" };
  }
  if (!release?.releaseDate) {
    await updateProductStatus(admin, productId, "ACTIVE");
    return { state: "ACTIVE_UNPUBLISHED", warning: "Release date is missing, so scheduled publication was skipped." };
  }
  await publishProductToOnlineStore({ admin, productId, publishDate: release.releaseDate });
  return { state: "SCHEDULED", publishDate: new Date(release.releaseDate).toISOString() };
}

export async function applyDefaultTrackPublication({ admin, productId, release, settings }) {
  return applyDefaultProductPublication({
    admin,
    productId,
    release,
    state: settings?.shopifyTrackProductDefaultState,
  });
}

export async function applyDefaultAlbumPublication({ admin, productId, release, settings }) {
  return applyDefaultProductPublication({
    admin,
    productId,
    release,
    state: settings?.shopifyAlbumProductDefaultState,
  });
}

export async function getTrackProductState(admin, productId) {
  if (!productId) return null;
  const response = await admin.graphql(`#graphql
    query ReleaseCoreTrackProductState($id: ID!) {
      product(id: $id) {
        id handle status templateSuffix
        resourcePublications(first: 50, onlyPublished: false) {
          nodes {
            isPublished
            publishDate
            publication { id name supportsFuturePublishing }
          }
        }
      }
    }
  `, { variables: { id: productId } });
  const json = await response.json();
  const product = json?.data?.product;
  if (!product) return null;
  const online = (product.resourcePublications?.nodes || []).find((item) => item.publication?.name === "Online Store")
    || (product.resourcePublications?.nodes || []).find((item) => item.publication?.supportsFuturePublishing)
    || null;
  const publishDate = online?.publishDate ? new Date(online.publishDate) : null;
  const scheduled = Boolean(online?.isPublished && publishDate && publishDate.getTime() > Date.now());
  return {
    id: product.id,
    handle: product.handle,
    status: product.status,
    templateSuffix: product.templateSuffix || null,
    onlineStore: online ? {
      isPublished: Boolean(online.isPublished),
      scheduled,
      publishDate: online.publishDate || null,
    } : { isPublished: false, scheduled: false, publishDate: null },
  };
}

export async function getReleaseProductState(admin, productId) {
  if (!productId) return null;
  const response = await admin.graphql(`#graphql
    query ReleaseCoreReleaseProductState($id: ID!) {
      product(id: $id) {
        id handle status templateSuffix
        variants(first: 1) {
          nodes {
            id
            requiresComponents
            productVariantComponents(first: 50) {
              nodes {
                quantity
                productVariant { id product { id title } }
              }
            }
          }
        }
        resourcePublications(first: 50, onlyPublished: false) {
          nodes {
            isPublished
            publishDate
            publication { id name supportsFuturePublishing }
          }
        }
      }
    }
  `, { variables: { id: productId } });
  const json = await response.json();
  const product = json?.data?.product;
  if (!product) return null;
  const online = (product.resourcePublications?.nodes || []).find((item) => item.publication?.name === "Online Store")
    || (product.resourcePublications?.nodes || []).find((item) => item.publication?.supportsFuturePublishing)
    || null;
  const publishDate = online?.publishDate ? new Date(online.publishDate) : null;
  const scheduled = Boolean(online?.isPublished && publishDate && publishDate.getTime() > Date.now());
  const variant = product.variants?.nodes?.[0] || null;
  const components = variant?.productVariantComponents?.nodes || [];
  return {
    id: product.id,
    handle: product.handle,
    status: product.status,
    templateSuffix: product.templateSuffix || null,
    isBundle: Boolean(variant?.requiresComponents && components.length),
    variantId: variant?.id || null,
    componentCount: components.length,
    componentProductIds: [...new Set(components.map((item) => item.productVariant?.product?.id).filter(Boolean))],
    onlineStore: online ? {
      isPublished: Boolean(online.isPublished),
      scheduled,
      publishDate: online.publishDate || null,
    } : { isPublished: false, scheduled: false, publishDate: null },
  };
}

function genreCandidates(value) {
  const normalized = normalize(value);
  const aliases = GENRE_ALIASES[normalized] || [normalized];
  return new Set([normalized, ...aliases.map(normalize)].filter(Boolean));
}

async function musicGenreDefinitionAndTaxonomy(admin) {
  const response = await admin.graphql(`#graphql
    query ReleaseCoreMusicGenreDefinition($categoryId: ID!, $categoryConstraint: String!) {
      node(id: $categoryId) {
        ... on TaxonomyCategory {
          attributes(first: 100) {
            nodes {
              ... on TaxonomyChoiceListAttribute {
                id
                name
                values(first: 250) { nodes { id name } }
              }
            }
          }
        }
      }
      metafieldDefinitions(
        first: 100,
        ownerType: PRODUCT,
        constraintSubtype: { key: "category", value: $categoryConstraint },
        constraintStatus: CONSTRAINED_AND_UNCONSTRAINED
      ) {
        nodes {
          id namespace key name
          type { name }
          validations { name value }
        }
      }
    }
  `, {
    variables: {
      categoryId: DIGITAL_MUSIC_CATEGORY_ID,
      categoryConstraint: DIGITAL_MUSIC_CATEGORY_ID,
    },
  });
  const json = await response.json();
  const definitions = json?.data?.metafieldDefinitions?.nodes || [];
  const definition = definitions.find((item) => item?.namespace === "shopify" && item?.key === "music-genre")
    || definitions.find((item) => /music\s*genre/i.test(item?.name || "") && item?.type?.name === "list.metaobject_reference")
    || null;
  const attributes = json?.data?.node?.attributes?.nodes || [];
  const taxonomy = attributes.find((item) => /music\s*genre/i.test(item?.name || ""))
    || attributes.find((item) => /genre/i.test(item?.name || ""))
    || null;
  return { definition, taxonomy };
}

async function enableMusicGenreDefinition(admin) {
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreEnableMusicGenreDefinition {
      standardMetafieldDefinitionEnable(
        ownerType: PRODUCT,
        namespace: "shopify",
        key: "music-genre",
        pin: true
      ) {
        createdDefinition {
          id namespace key name
          type { name }
          validations { name value }
        }
        userErrors { field message code }
      }
    }
  `);
  const json = await response.json();
  const errors = json?.data?.standardMetafieldDefinitionEnable?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
  return json?.data?.standardMetafieldDefinitionEnable?.createdDefinition || null;
}

async function loadMusicGenreEntries(admin, definitionId) {
  const response = await admin.graphql(`#graphql
    query ReleaseCoreMusicGenreEntries($definitionId: ID!) {
      node(id: $definitionId) {
        ... on MetaobjectDefinition {
          id
          type
          metaobjects(first: 250) {
            nodes {
              id
              handle
              displayName
              fields { key value }
            }
          }
        }
      }
    }
  `, { variables: { definitionId } });
  const json = await response.json();
  const definition = json?.data?.node || null;
  return {
    type: definition?.type || null,
    entries: definition?.metaobjects?.nodes || [],
  };
}

function taxonomyReference(entry) {
  return (entry?.fields || []).find((field) => field?.key === "taxonomy_reference")?.value || null;
}

async function createMusicGenreEntry(admin, definitionType, taxonomyValue) {
  if (!definitionType || !taxonomyValue?.id || !taxonomyValue?.name) return null;
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreCreateMusicGenre($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { id handle displayName type }
        userErrors { field message code }
      }
    }
  `, {
    variables: {
      metaobject: {
        type: definitionType,
        fields: [
          { key: "label", value: taxonomyValue.name },
          { key: "taxonomy_reference", value: taxonomyValue.id },
        ],
      },
    },
  });
  const json = await response.json();
  const errors = json?.data?.metaobjectCreate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
  return json?.data?.metaobjectCreate?.metaobject || null;
}

export async function resolveShopifyMusicGenreMetafield(admin, genre) {
  if (!genre) return null;
  try {
    const candidates = genreCandidates(genre);
    const context = await musicGenreDefinitionAndTaxonomy(admin);
    let definition = context.definition;
    const taxonomy = context.taxonomy;
    if (!definition) definition = await enableMusicGenreDefinition(admin);
    if (!definition || definition.type?.name !== "list.metaobject_reference") return null;

    const metaobjectDefinitionId = (definition.validations || [])
      .find((validation) => validation?.name === "metaobject_definition_id")?.value;
    if (!metaobjectDefinitionId) return null;

    const { type: definitionType, entries } = await loadMusicGenreEntries(admin, metaobjectDefinitionId);
    const selected = [];
    const selectedIds = new Set();
    const addEntry = (entry) => {
      if (!entry?.id || selectedIds.has(entry.id)) return;
      selectedIds.add(entry.id);
      selected.push(entry);
    };

    // Preserve merchant-created/Shopify-standard labels that directly match the ReleaseCore genre.
    for (const entry of entries) {
      if (candidates.has(normalize(entry?.displayName)) || candidates.has(normalize(entry?.handle))) addEntry(entry);
    }

    // Shopify's native Music genre metafield references standard metaobjects. Ensure the
    // canonical taxonomy-backed entries exist for every exact ReleaseCore/alias match.
    const taxonomyValues = taxonomy?.values?.nodes || [];
    const taxonomyMatches = taxonomyValues.filter((item) => candidates.has(normalize(item?.name)));
    for (const taxonomyValue of taxonomyMatches) {
      const exactEntry = entries.find((entry) => (
        taxonomyReference(entry) === taxonomyValue.id
        && normalize(entry?.displayName) === normalize(taxonomyValue.name)
      ));
      if (exactEntry) {
        addEntry(exactEntry);
        continue;
      }
      try {
        const created = await createMusicGenreEntry(admin, definitionType, taxonomyValue);
        if (created) addEntry(created);
      } catch (error) {
        console.warn("ReleaseCore: Shopify Music genre value could not be created", {
          genre: taxonomyValue.name,
          message: String(error?.message || error),
        });
      }
    }

    if (!selected.length) return null;
    return {
      namespace: "shopify",
      key: "music-genre",
      type: "list.metaobject_reference",
      value: JSON.stringify(selected.map((entry) => entry.id)),
      matchedName: selected.map((entry) => entry.displayName).filter(Boolean).join(", "),
      matchedNames: selected.map((entry) => entry.displayName).filter(Boolean),
    };
  } catch (error) {
    console.warn("ReleaseCore: Shopify Music genre sync skipped", { message: String(error?.message || error) });
    return null;
  }
}
