import { normalizeTemplateSuffix } from "./shopify-catalog.server";
import { publicError } from "./http-security.server";
import { deploymentProfileId } from "./deployment-profile.server";

const RELEASECORE_COLLECTION_SOURCE_TITLE = "ReleaseCore artist catalog";

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function descriptionHtml(artist) {
  const biography = String(artist?.biography || "").trim();
  if (!biography) return "";
  return biography
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

function publicProfile(artist) {
  return {
    name: artist?.name || null,
    spotifyUrl: artist?.spotifyUrl || null,
    appleMusicUrl: artist?.appleMusicUrl || null,
    websiteUrl: artist?.websiteUrl || null,
    instagramUrl: artist?.instagramUrl || null,
    facebookUrl: artist?.facebookUrl || null,
    tiktokUrl: artist?.tiktokUrl || null,
    youtubeUrl: artist?.youtubeUrl || null,
    xUrl: artist?.xUrl || null,
  };
}

function metadataInput(artist, settings) {
  const metafields = [
    {
      namespace: "releasecore",
      key: "collection_type",
      type: "single_line_text_field",
      value: "artist",
    },
    {
      namespace: "releasecore",
      key: "artist_id",
      type: "single_line_text_field",
      value: String(artist.id),
    },
    {
      namespace: "releasecore",
      key: "artist_name",
      type: "single_line_text_field",
      value: String(artist.name || ""),
    },
    {
      namespace: "releasecore",
      key: "artist_profile",
      type: "json",
      value: JSON.stringify(publicProfile(artist)),
    },
  ];

  // East Rock's existing custom.collection_type definition is a merchant
  // choice metafield whose allowed value is title-cased "Artist".
  // Keep ReleaseCore's canonical namespace independent from this legacy field.
  if (deploymentProfileId() === "east-rock") {
    metafields.push({
      namespace: "custom",
      key: "collection_type",
      type: "single_line_text_field",
      value: "Artist",
    });
  }

  const input = {
    title: artist.name || "Artist",
    descriptionHtml: descriptionHtml(artist),
    metafields,
  };

  const templateSuffix = normalizeTemplateSuffix(
    settings?.shopifyArtistCollectionTemplateSuffix,
  );
  if (templateSuffix) input.templateSuffix = templateSuffix;

  if (artist.imageUrl) {
    input.image = {
      src: artist.imageUrl,
      altText: `${artist.name || "Artist"} artist image`,
    };
  }

  return input;
}

function graphqlMessages(json) {
  return (json?.errors || [])
    .map((error) => String(error?.message || "").trim())
    .filter(Boolean);
}

async function parseGraphql(response, context) {
  const json = await response.json();
  const errors = graphqlMessages(json);
  if (errors.length) {
    throw publicError(`${context}: ${errors.join(" ")}`, { status: 409 });
  }
  return json;
}

function throwUserErrors(errors, fallback = null) {
  const messages = (errors || [])
    .map((error) => String(error?.message || "").trim())
    .filter(Boolean);
  if (messages.length) throw publicError(messages.join(" "), { status: 409 });
  if (fallback) throw publicError(fallback, { status: 409 });
}

function releaseCoreSource(collection, sourceId = null) {
  const sources = collection?.sources || [];
  if (sourceId) {
    const exact = sources.find((source) => source.id === sourceId);
    if (exact) return exact;
  }

  return (
    sources.find(
      (source) =>
        source.__typename === "CollectionConditionsSource" &&
        source.title === RELEASECORE_COLLECTION_SOURCE_TITLE,
    ) || null
  );
}

function selectedProductIds(source) {
  return unique(
    (source?.inclusion?.selections?.nodes || []).map(
      (selection) => selection?.product?.id,
    ),
  );
}

function managedProductIds(collection) {
  const raw = collection?.managedProductIds?.value;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? unique(parsed.map((value) => String(value || "").trim()))
      : [];
  } catch {
    return [];
  }
}

async function setManagedProductIds(admin, collectionId, productIds) {
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreSetArtistCollectionManagedProducts(
      $metafields: [MetafieldsSetInput!]!
    ) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key type value }
        userErrors { field message code }
      }
    }
  `, {
    variables: {
      metafields: [
        {
          ownerId: collectionId,
          namespace: "releasecore",
          key: "managed_product_ids",
          type: "json",
          value: JSON.stringify(unique(productIds)),
        },
      ],
    },
  });

  const json = await parseGraphql(
    response,
    "Shopify could not save ReleaseCore artist collection ownership",
  );

  throwUserErrors(json?.data?.metafieldsSet?.userErrors);
}

export async function getShopifyArtistCollection(admin, collectionId) {
  if (!collectionId) return null;

  const response = await admin.graphql(`#graphql
    query ReleaseCoreArtistCollection($id: ID!) {
      collection(id: $id) {
        id
        title
        handle
        templateSuffix
        image { url altText }
        managedProductIds: metafield(
          namespace: "releasecore"
          key: "managed_product_ids"
        ) {
          id
          type
          value
        }
        sources {
          __typename
          id
          title
          ... on CollectionConditionsSource {
            inclusion {
              selections(first: 250) {
                nodes {
                  product { id title }
                  variantIds
                }
              }
            }
          }
        }
      }
    }
  `, { variables: { id: collectionId } });

  const json = await parseGraphql(
    response,
    "Shopify could not read the artist collection",
  );
  return json?.data?.collection || null;
}

export async function listShopifyArtistCollections(admin) {
  const response = await admin.graphql(`#graphql
    query ReleaseCoreArtistCollectionCandidates {
      collections(first: 100, sortKey: TITLE) {
        nodes {
          id
          title
          handle
          templateSuffix
          image { url altText }
        }
      }
    }
  `);

  const json = await parseGraphql(
    response,
    "Shopify could not list collections",
  );
  return json?.data?.collections?.nodes || [];
}

async function createArtistCollection(admin, artist, settings, productIds) {
  const collection = {
    ...metadataInput(artist, settings),
    sortOrder: "CREATED_DESC",
    ...(productIds.length
      ? {
          sources: [
            {
              source: {
                title: RELEASECORE_COLLECTION_SOURCE_TITLE,
                description: "Products synchronized from ReleaseCore artist assignments.",
                targetType: "PRODUCTS",
                inclusion: {
                  selections: productIds.map((productId) => ({ productId })),
                },
              },
            },
          ],
        }
      : {}),
  };

  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreCreateArtistCollection($collection: CollectionCreateInput!) {
      collectionCreate(collection: $collection) {
        collection {
          id
          title
          handle
          templateSuffix
          image { url altText }
          sources {
            __typename
            id
            title
            ... on CollectionConditionsSource {
              inclusion {
                selections(first: 250) {
                  nodes {
                    product { id title }
                    variantIds
                  }
                }
              }
            }
          }
        }
        userErrors { field message }
      }
    }
  `, { variables: { collection } });

  const json = await parseGraphql(
    response,
    "Shopify could not create the artist collection",
  );

  const payload = json?.data?.collectionCreate;
  throwUserErrors(
    payload?.userErrors,
    payload?.collection?.id
      ? null
      : "Shopify did not return the created artist collection.",
  );

  return payload.collection;
}

async function updateArtistCollection(admin, collectionId, artist, settings) {
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreUpdateArtistCollection($collection: CollectionUpdateInput!) {
      collectionUpdate(collection: $collection) {
        collection { id title handle templateSuffix }
        job { id done }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      collection: {
        id: collectionId,
        ...metadataInput(artist, settings),
      },
    },
  });

  const json = await parseGraphql(
    response,
    "Shopify could not update the artist collection",
  );

  throwUserErrors(json?.data?.collectionUpdate?.userErrors);
}

async function createReleaseCoreSource(admin, collectionId, productIds) {
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreCreateArtistCollectionSource($collection: CollectionUpdateInput!) {
      collectionUpdate(collection: $collection) {
        collection {
          id
          sources {
            __typename
            id
            title
            ... on CollectionConditionsSource {
              inclusion {
                selections(first: 250) {
                  nodes {
                    product { id title }
                    variantIds
                  }
                }
              }
            }
          }
        }
        job { id done }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      collection: {
        id: collectionId,
        sourcesToCreate: [
          {
            source: {
              title: RELEASECORE_COLLECTION_SOURCE_TITLE,
              description: "Products synchronized from ReleaseCore artist assignments.",
              targetType: "PRODUCTS",
              inclusion: {
                selections: productIds.map((productId) => ({ productId })),
              },
            },
          },
        ],
      },
    },
  });

  const json = await parseGraphql(
    response,
    "Shopify could not attach ReleaseCore to the artist collection",
  );

  const payload = json?.data?.collectionUpdate;
  throwUserErrors(payload?.userErrors);
  return payload?.collection || null;
}

async function syncReleaseCoreSource(
  admin,
  collectionId,
  source,
  productIds,
  previouslyManagedProductIds,
) {
  const desired = unique(productIds);
  const current = selectedProductIds(source);
  const previouslyManaged = unique(previouslyManagedProductIds);

  const desiredSet = new Set(desired);
  const currentSet = new Set(current);

  const selectionsToAdd = desired
    .filter((id) => !currentSet.has(id))
    .map((productId) => ({ productId }));

  // Critical ownership boundary:
  // only remove products ReleaseCore explicitly recorded as managed on the
  // previous successful sync. Merchant-added products are never inferred to
  // be ReleaseCore-owned just because Shopify put them in this source.
  const selectionsToRemove = previouslyManaged
    .filter(
      (id) =>
        currentSet.has(id) &&
        !desiredSet.has(id),
    )
    .map((productId) => ({ productId }));

  if (!selectionsToAdd.length && !selectionsToRemove.length) return;

  const inclusion = {};
  if (selectionsToAdd.length) inclusion.selectionsToAdd = selectionsToAdd;
  if (selectionsToRemove.length) inclusion.selectionsToRemove = selectionsToRemove;

  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreSyncArtistCollectionProducts($collection: CollectionUpdateInput!) {
      collectionUpdate(collection: $collection) {
        collection { id }
        job { id done }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      collection: {
        id: collectionId,
        sourcesToUpdate: [
          {
            condition: {
              id: source.id,
              inclusion,
            },
          },
        ],
      },
    },
  });

  const json = await parseGraphql(
    response,
    "Shopify could not sync artist collection products",
  );

  throwUserErrors(json?.data?.collectionUpdate?.userErrors);
}

export async function syncShopifyArtistCollection({
  admin,
  artist,
  settings,
  productIds,
  collectionId = null,
  sourceId = null,
}) {
  const desiredProductIds = unique(productIds);

  let collection = collectionId
    ? await getShopifyArtistCollection(admin, collectionId)
    : null;

  let created = false;

  if (!collection) {
    collection = await createArtistCollection(
      admin,
      artist,
      settings,
      desiredProductIds,
    );
    created = true;
  } else {
    await updateArtistCollection(
      admin,
      collection.id,
      artist,
      settings,
    );

    collection =
      (await getShopifyArtistCollection(admin, collection.id)) || collection;
  }

  const previousManagedProductIds = managedProductIds(collection);
  let source = releaseCoreSource(collection, sourceId);

  if (!source && desiredProductIds.length) {
    collection = await createReleaseCoreSource(
      admin,
      collection.id,
      desiredProductIds,
    );
    source = releaseCoreSource(collection);
  } else if (source && !created) {
    await syncReleaseCoreSource(
      admin,
      collection.id,
      source,
      desiredProductIds,
      previousManagedProductIds,
    );
  }

  await setManagedProductIds(
    admin,
    collection.id,
    desiredProductIds,
  );

  const finalCollection =
    (await getShopifyArtistCollection(admin, collection.id)) || collection;

  const finalSource = releaseCoreSource(
    finalCollection,
    source?.id || sourceId,
  );

  return {
    collection: finalCollection,
    sourceId: finalSource?.id || source?.id || null,
    productCount: desiredProductIds.length,
    created,
  };
}
