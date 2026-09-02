import db from "../db.server";
import { deleteShopifyFilesBestEffort } from "./shopify-files.server";

const clean = (value) => String(value || "").trim() || null;

async function portalArtistIds({ shop, customerId }) {
  const [policy, access, ownedReleases] = await Promise.all([
    db.portalCustomerPolicy.findUnique({ where: { shop_customerId: { shop, customerId } } }),
    db.portalArtistAccess.findMany({ where: { shop, customerId }, select: { artistId: true } }),
    db.release.findMany({ where: { shop, ownerCustomerId: customerId }, select: { artists: { select: { artistId: true } } } }),
  ]);
  const ids = new Set(access.map((item) => item.artistId));
  if (policy?.soloArtistId) ids.add(policy.soloArtistId);
  for (const release of ownedReleases) for (const assignment of release.artists) ids.add(assignment.artistId);
  return [...ids];
}

export async function listPortalArtistProfiles({ shop, customerId }) {
  const ids = await portalArtistIds({ shop, customerId });
  const [artists, settings] = await Promise.all([
    ids.length
      ? db.artist.findMany({
          where: { shop, id: { in: ids } }, orderBy: { name: "asc" },
          select: { id: true, name: true, legalName: true, email: true, pro: true, ipi: true, imageUrl: true, biography: true, websiteUrl: true, spotifyUrl: true, appleMusicUrl: true, instagramUrl: true, facebookUrl: true, tiktokUrl: true, youtubeUrl: true, xUrl: true },
        })
      : Promise.resolve([]),
    db.appSettings.findUnique({
      where: { shop },
      select: { lockArtistNameEditing: true },
    }),
  ]);
  return {
    artists,
    policy: { lockArtistNameEditing: settings?.lockArtistNameEditing ?? true },
  };
}

async function requirePortalArtist({ shop, customerId, artistId }) {
  const ids = await portalArtistIds({ shop, customerId });
  if (!ids.includes(artistId)) throw new Response("You do not have access to this artist profile.", { status: 403 });
  const artist = await db.artist.findFirst({ where: { id: artistId, shop } });
  if (!artist) throw new Response("Artist profile not found.", { status: 404 });
  return artist;
}

export async function updatePortalArtistProfile({ shop, customerId, formData }) {
  const artistId = String(formData.get("artistId") || "");
  const artist = await requirePortalArtist({ shop, customerId, artistId });
  const settings = await db.appSettings.findUnique({
    where: { shop },
    select: { lockArtistNameEditing: true },
  });
  const nameLocked = settings?.lockArtistNameEditing ?? true;
  const requestedName = String(formData.get("name") || "").trim();
  const name = nameLocked ? artist.name : requestedName;
  if (!name) throw new Error("Artist name is required.");
  const updated = await db.artist.update({
    where: { id: artist.id },
    data: {
      name,
      legalName: clean(formData.get("legalName")), email: clean(formData.get("email")), pro: clean(formData.get("pro")), ipi: clean(formData.get("ipi")), biography: clean(formData.get("biography")), websiteUrl: clean(formData.get("websiteUrl")), spotifyUrl: clean(formData.get("spotifyUrl")), appleMusicUrl: clean(formData.get("appleMusicUrl")), instagramUrl: clean(formData.get("instagramUrl")), facebookUrl: clean(formData.get("facebookUrl")), tiktokUrl: clean(formData.get("tiktokUrl")), youtubeUrl: clean(formData.get("youtubeUrl")), xUrl: clean(formData.get("xUrl")),
    },
  });
  if (name !== artist.name) {
    const releaseAssignments = await db.releaseArtist.findMany({ where: { artistId }, select: { releaseId: true } });
    for (const assignment of releaseAssignments) {
      const primary = await db.releaseArtist.findFirst({ where: { releaseId: assignment.releaseId, role: "PRIMARY" }, include: { artist: true }, orderBy: { position: "asc" } });
      await db.release.update({ where: { id: assignment.releaseId }, data: { artistName: primary?.artist?.name || null } });
    }
  }
  return updated;
}

export async function stagePortalArtistImage({ admin, shop, customerId, formData }) {
  const artistId = String(formData.get("artistId") || "");
  await requirePortalArtist({ shop, customerId, artistId });
  const filename = String(formData.get("filename") || "artist.jpg").trim();
  const mimeType = String(formData.get("mimeType") || "image/jpeg").toLowerCase();
  const sizeBytes = Number(formData.get("sizeBytes") || 0);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType) || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 10 * 1024 * 1024) throw new Error("Artist images must be JPG, PNG, or WebP and no larger than 10 MB.");
  const response = await admin.graphql(`#graphql
mutation ReleaseCorePortalStageArtistImage($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}} userErrors{message}}}`, { variables: { input: [{ filename, mimeType, fileSize: String(sizeBytes), httpMethod: "POST", resource: "IMAGE" }] } });
  const json = await response.json(); const payload = json?.data?.stagedUploadsCreate;
  if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((item) => item.message).join(" "));
  const target = payload?.stagedTargets?.[0]; if (!target?.url || !target?.resourceUrl) throw new Error("Shopify did not return an artist image upload target.");
  return target;
}

export async function completePortalArtistImage({ admin, shop, customerId, formData }) {
  const artistId = String(formData.get("artistId") || "");
  const artist = await requirePortalArtist({ shop, customerId, artistId });
  const resourceUrl = String(formData.get("resourceUrl") || ""); if (!resourceUrl) throw new Error("Artist image resource URL is missing.");
  const response = await admin.graphql(`#graphql
mutation ReleaseCorePortalCreateArtistImage($files:[FileCreateInput!]!){fileCreate(files:$files){files{id ... on MediaImage{image{url}}} userErrors{message}}}`, { variables: { files: [{ contentType: "IMAGE", originalSource: resourceUrl, alt: `${artist.name} artist profile` }] } });
  const json = await response.json(); const payload = json?.data?.fileCreate;
  if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((item) => item.message).join(" "));
  const file = payload?.files?.[0]; if (!file?.id) throw new Error("Shopify did not create the artist image.");
  const imageUrl = file.image?.url || resourceUrl;
  await db.artist.update({ where: { id: artist.id }, data: { imageUrl, imageFileId: file.id } });
  if (artist.imageFileId && artist.imageFileId !== file.id) {
    await deleteShopifyFilesBestEffort(admin, artist.imageFileId, {
      context: "replaced portal artist image cleanup",
    });
  }
  return { imageUrl };
}
