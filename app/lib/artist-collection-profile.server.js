import { deploymentProfileId } from "./deployment-profile.server";
import { publicError } from "./http-security.server";

const EAST_ROCK_PROFILE_METAFIELDS = [
  { field: "websiteUrl", key: "website_url" },
  { field: "spotifyUrl", key: "spotify_url" },
  { field: "appleMusicUrl", key: "apple_music_url" },
  { field: "instagramUrl", key: "instagram_url" },
  { field: "facebookUrl", key: "facebook_url" },
  { field: "tiktokUrl", key: "tiktok_url" },
  { field: "youtubeUrl", key: "youtube_url" },
  { field: "xUrl", key: "x_url" },
];

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

function eastRockMetafields(artist) {
  if (deploymentProfileId() !== "east-rock") return [];
  return EAST_ROCK_PROFILE_METAFIELDS
    .filter(({ field }) => String(artist?.[field] || "").trim())
    .map(({ field, key }) => ({
      namespace: "custom",
      key,
      type: "url",
      value: String(artist[field]).trim(),
    }));
}

async function deleteEmptyEastRockMetafields(admin, collectionId, artist) {
  if (deploymentProfileId() !== "east-rock") return;

  const metafields = EAST_ROCK_PROFILE_METAFIELDS
    .filter(({ field }) => !String(artist?.[field] || "").trim())
    .map(({ key }) => ({
      ownerId: collectionId,
      namespace: "custom",
      key,
    }));

  if (!metafields.length) return;

  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreDeleteEmptyArtistProfileMetafields(
      $metafields: [MetafieldIdentifierInput!]!
    ) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields { ownerId namespace key }
        userErrors { field message }
      }
    }
  `, { variables: { metafields } });

  const json = await parseGraphql(
    response,
    "Shopify could not clear artist collection profile fields",
  );
  throwUserErrors(json?.data?.metafieldsDelete?.userErrors);
}

export async function syncArtistCollectionProfile({ admin, artist }) {
  const collectionId = String(artist?.shopifyCollectionId || "").trim();
  if (!collectionId) return { connected: false };

  const metafields = [
    {
      namespace: "releasecore",
      key: "artist_name",
      type: "single_line_text_field",
      value: String(artist?.name || ""),
    },
    {
      namespace: "releasecore",
      key: "artist_profile",
      type: "json",
      value: JSON.stringify(publicProfile(artist)),
    },
    ...eastRockMetafields(artist),
  ];

  const collection = {
    id: collectionId,
    title: artist?.name || "Artist",
    descriptionHtml: descriptionHtml(artist),
    metafields,
  };

  if (artist?.imageUrl) {
    collection.image = {
      src: artist.imageUrl,
      altText: `${artist?.name || "Artist"} artist image`,
    };
  }

  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreSyncArtistCollectionProfile(
      $collection: CollectionUpdateInput!
    ) {
      collectionUpdate(collection: $collection) {
        collection { id title handle image { url altText } }
        job { id done }
        userErrors { field message }
      }
    }
  `, { variables: { collection } });

  const json = await parseGraphql(
    response,
    "Shopify could not update the artist collection profile",
  );
  const payload = json?.data?.collectionUpdate;
  throwUserErrors(
    payload?.userErrors,
    payload?.collection?.id ? null : "Shopify did not return the linked artist collection.",
  );

  await deleteEmptyEastRockMetafields(admin, collectionId, artist);

  return {
    connected: true,
    collection: payload.collection,
  };
}
