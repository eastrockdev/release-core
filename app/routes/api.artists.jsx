import { authenticate } from "../shopify.server";
import db from "../db.server";
import { apiErrorResponse, publicError } from "../lib/http-security.server";
import { findShopArtist, findShopContributor } from "../lib/tenant-db.server";
import { deleteShopifyFilesBestEffort } from "../lib/shopify-files.server";
import { getShopifyArtistCollection, syncShopifyArtistCollection } from "../lib/shopify-artist-collections.server";
import { syncArtistCollectionProfile } from "../lib/artist-collection-profile.server";

const clean = (value) => String(value || "").trim() || null;

export const action = async ({ request }) => {
  if (request.method !== "POST") return Response.json({ ok:false, error:"Method not allowed." }, { status:405 });
  try {
    const { admin, session } = await authenticate.admin(request);
    const data = await request.formData();
    const intent = String(data.get("intent") || "");
    const artistId = String(data.get("artistId") || "");

    if (
      intent === "sync-shopify-collection" ||
      intent === "link-shopify-collection" ||
      intent === "unlink-shopify-collection"
    ) {
      const artist = await findShopArtist(session.shop, artistId);

      if (!artist) {
        return Response.json(
          { ok:false, error:"Artist not found." },
          { status:404 },
        );
      }

      if (intent === "unlink-shopify-collection") {
        await db.artist.update({
          where: { id: artist.id },
          data: {
            shopifyCollectionId: null,
            shopifyCollectionHandle: null,
            shopifyCollectionSourceId: null,
            shopifyCollectionSyncedAt: null,
          },
        });

        return Response.json({
          ok:true,
          message:"Shopify collection disconnected. The Shopify collection was left unchanged.",
        });
      }

      let collectionId = artist.shopifyCollectionId || null;
      let sourceId = artist.shopifyCollectionSourceId || null;

      if (intent === "link-shopify-collection") {
        collectionId = String(data.get("collectionId") || "").trim();
        sourceId = null;

        if (!collectionId) {
          return Response.json(
            { ok:false, error:"Choose a Shopify collection to link." },
            { status:400 },
          );
        }

        const duplicate = await db.artist.findFirst({
          where: {
            shop: session.shop,
            shopifyCollectionId: collectionId,
            id: { not: artist.id },
          },
          select: { id:true, name:true },
        });

        if (duplicate) {
          return Response.json(
            {
              ok:false,
              error:`That Shopify collection is already linked to ${duplicate.name}.`,
            },
            { status:409 },
          );
        }

        const existing = await getShopifyArtistCollection(admin, collectionId);

        if (!existing) {
          return Response.json(
            { ok:false, error:"That Shopify collection no longer exists." },
            { status:404 },
          );
        }
      }

      const [settings, trackAssignments, releaseAssignments] =
        await Promise.all([
          db.appSettings.findUnique({
            where: { shop: session.shop },
          }),
          db.trackArtist.findMany({
            where: {
              artistId: artist.id,
              track: {
                release: { shop: session.shop },
              },
            },
            select: {
              track: {
                select: { shopifyProductId:true },
              },
            },
          }),
          db.releaseArtist.findMany({
            where: {
              artistId: artist.id,
              release: { shop: session.shop },
            },
            select: {
              release: {
                select: { shopifyReleaseProductId:true },
              },
            },
          }),
        ]);

      const productIds = [
        ...new Set([
          ...trackAssignments.map(
            (item) => item.track.shopifyProductId,
          ),
          ...releaseAssignments.map(
            (item) => item.release.shopifyReleaseProductId,
          ),
        ].filter(Boolean)),
      ];

      const result = await syncShopifyArtistCollection({
        admin,
        artist,
        settings,
        productIds,
        collectionId,
        sourceId,
      });

      const linkedArtist = await db.artist.update({
        where: { id: artist.id },
        data: {
          shopifyCollectionId: result.collection.id,
          shopifyCollectionHandle: result.collection.handle || null,
          shopifyCollectionSourceId: result.sourceId || null,
          shopifyCollectionSyncedAt: new Date(),
        },
      });

      await syncArtistCollectionProfile({ admin, artist: linkedArtist });

      return Response.json({
        ok:true,
        collectionId:result.collection.id,
        handle:result.collection.handle || null,
        productCount:result.productCount,
        message:result.created
          ? `Shopify artist collection created with ${result.productCount} linked product${result.productCount === 1 ? "" : "s"}.`
          : `Shopify artist collection synced with ${result.productCount} linked product${result.productCount === 1 ? "" : "s"}.`,
      });
    }

    if (intent === "stage-image") {
      const artist = await findShopArtist(session.shop, artistId);
      if (!artist) return Response.json({ ok:false, error:"Artist not found." }, { status:404 });
      const filename = String(data.get("filename") || "artist.jpg").trim();
      const mimeType = String(data.get("mimeType") || "image/jpeg").toLowerCase();
      const sizeBytes = Number(data.get("sizeBytes") || 0);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 10 * 1024 * 1024) {
        return Response.json({ ok:false, error:"Artist images must be JPG, PNG, or WebP and no larger than 10 MB." }, { status:400 });
      }
      const response = await admin.graphql(`#graphql
mutation ReleaseCoreStageArtistImage($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}} userErrors{message}}}`, { variables: { input: [{ filename, mimeType, fileSize: String(sizeBytes), httpMethod: "POST", resource: "IMAGE" }] } });
      const json = await response.json();
      const staged = json?.data?.stagedUploadsCreate;
      if (staged?.userErrors?.length) throw publicError(staged.userErrors.map((item) => item.message).join(" "), { status: 400 });
      const target = staged?.stagedTargets?.[0];
      if (!target?.url || !target?.resourceUrl) throw new Error("Shopify did not return an artist image upload target.");
      return Response.json({ ok:true, target });
    }

    if (intent === "complete-image") {
      const artist = await findShopArtist(session.shop, artistId);
      if (!artist) return Response.json({ ok:false, error:"Artist not found." }, { status:404 });
      const resourceUrl = String(data.get("resourceUrl") || "");
      if (!resourceUrl) return Response.json({ ok:false, error:"Artist image resource URL is missing." }, { status:400 });
      const response = await admin.graphql(`#graphql
mutation ReleaseCoreCreateArtistImage($files:[FileCreateInput!]!){fileCreate(files:$files){files{id fileStatus ... on MediaImage{image{url}}} userErrors{message}}}`, { variables: { files: [{ contentType: "IMAGE", originalSource: resourceUrl, alt: `${artist.name} artist profile` }] } });
      const json = await response.json();
      const created = json?.data?.fileCreate;
      if (created?.userErrors?.length) throw publicError(created.userErrors.map((item) => item.message).join(" "), { status: 400 });
      const file = created?.files?.[0];
      if (!file?.id) throw new Error("Shopify did not create the artist image.");
      const imageUrl = file.image?.url || resourceUrl;
      const updated = await db.artist.update({ where: { id: artist.id }, data: { imageUrl, imageFileId: file.id } });
      await syncArtistCollectionProfile({ admin, artist: updated });
      if (artist.imageFileId && artist.imageFileId !== file.id) {
        await deleteShopifyFilesBestEffort(admin, artist.imageFileId, {
          context: "old artist image cleanup",
        });
      }
      return Response.json({ ok:true, imageUrl, message:"Artist image updated." });
    }

    if (intent === "link-contributor" || intent === "unlink-contributor") {
      const contributorId = String(data.get("contributorId") || "");
      const [artist, contributor] = await Promise.all([
        findShopArtist(session.shop, artistId),
        findShopContributor(session.shop, contributorId),
      ]);
      if (!artist || !contributor) return Response.json({ ok:false, error:"Artist or contributor not found." }, { status:404 });
      if (intent === "link-contributor") {
        await db.artistContributor.upsert({
          where: { artistId_contributorId: { artistId, contributorId } },
          create: { artistId, contributorId },
          update: {},
        });
        return Response.json({ ok:true, message:`${contributor.stageName || contributor.legalName} linked to ${artist.name}.` });
      }
      await db.artistContributor.deleteMany({ where: { artistId, contributorId } });
      return Response.json({ ok:true, message:`Contributor removed from ${artist.name}.` });
    }

    const payload = {};
    if (data.has("name")) payload.name = String(data.get("name") || "").trim();
    for (const field of ["legalName", "email", "spotifyUrl", "appleMusicUrl", "websiteUrl", "imageUrl", "biography", "pro", "ipi", "instagramUrl", "facebookUrl", "tiktokUrl", "youtubeUrl", "xUrl", "notes"]) {
      if (data.has(field)) payload[field] = clean(data.get(field));
    }
    if ((intent === "create" || data.has("name")) && !payload.name) return Response.json({ ok:false, error:"Artist name is required." }, { status:400 });

    if (intent === "create") {
      const artist = await db.artist.create({ data: { shop:session.shop, ...payload } });
      return Response.json({ ok:true, artistId:artist.id, message:`${artist.name} added to the artist directory.` });
    }
    if (intent === "update") {
      const owned = await findShopArtist(session.shop, artistId);
      if (!owned) return Response.json({ ok:false, error:"Artist not found." }, { status:404 });
      const artist = await db.artist.update({ where:{id:owned.id}, data:payload });
      await syncArtistCollectionProfile({ admin, artist });

      // Refresh the legacy release display cache anywhere this artist is the first primary release artist.
      const assignments = await db.releaseArtist.findMany({ where:{artistId:artist.id, release:{shop:session.shop}}, select:{releaseId:true} });
      for (const assignment of assignments) {
        const releaseArtists = await db.releaseArtist.findMany({ where:{releaseId:assignment.releaseId, release:{shop:session.shop}}, include:{artist:true}, orderBy:{position:"asc"} });
        const first = releaseArtists.find((item)=>item.role==="PRIMARY") || releaseArtists[0];
        await db.release.update({ where:{id:assignment.releaseId}, data:{artistName:first?.artist?.name || null} });
      }
      return Response.json({ ok:true, message:`${artist.name} updated.` });
    }
    return Response.json({ ok:false, error:"Unknown artist action." }, { status:400 });
  } catch (error) {
    return apiErrorResponse(request, error, { context: "artist mutation", fallback: "ReleaseCore could not save this artist." });
  }
};