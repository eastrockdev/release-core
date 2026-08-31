import { authenticate } from "../shopify.server";
import db from "../db.server";
import { FILE_KINDS, validateUploadDescriptor } from "../lib/releasecore-files";
import { deleteLocalStorageKey, deleteR2StorageKey, saveMasterStream } from "../lib/storage.server";

import { releaseIsEditable } from "../lib/workflow";
export const action = async ({ request }) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  let savedKey = null;
  try {
    const { admin, session } = await authenticate.admin(request);
    const url = new URL(request.url);
    const releaseId = url.searchParams.get("releaseId") || "";
    const trackId = url.searchParams.get("trackId") || "";
    const filename = decodeURIComponent(url.searchParams.get("filename") || "master.wav");
    const mimeType = request.headers.get("content-type") || "audio/wav";
    const sizeBytes = Number(request.headers.get("x-releasecore-size") || request.headers.get("content-length") || 0);

    const release = await db.release.findFirst({ where: { id: releaseId, shop: session.shop }, include: { tracks: true } });
    if (!release) return Response.json({ ok: false, error: "Release not found." }, { status: 404 });
    if (!releaseIsEditable(release.status)) return Response.json({ ok: false, error: "This release is locked while it is under review or finalized." }, { status: 409 });
    const track = release.tracks.find((item) => item.id === trackId);
    if (!track) return Response.json({ ok: false, error: "Track does not belong to this release." }, { status: 404 });
    const descriptor = validateUploadDescriptor({ kind: FILE_KINDS.MASTER_WAV, filename, mimeType, sizeBytes, trackId });

    savedKey = await saveMasterStream({ stream: request.body, shop: session.shop, releaseId, trackId, filename: descriptor.name });
    const existing = await db.releaseFile.findMany({ where: { releaseId, trackId, kind: FILE_KINDS.MASTER_WAV } });
    for (const item of existing) {
      if (item.storageProvider === "R2" && item.storageKey) await deleteR2StorageKey(item.storageKey);
      else if (item.storageProvider === "LOCAL_DEV" && item.storageKey) await deleteLocalStorageKey(item.storageKey);
    }
    if (existing.length) await db.releaseFile.deleteMany({ where: { id: { in: existing.map((item) => item.id) } } });

    const stalePreviews = await db.releaseFile.findMany({ where: { releaseId, trackId, kind: FILE_KINDS.PREVIEW_MP3 } });
    const shopifyPreviewIds = stalePreviews.filter((item) => item.storageProvider === "SHOPIFY_FILES" && item.storageKey).map((item) => item.storageKey);
    if (shopifyPreviewIds.length) {
      try {
        await admin.graphql(`#graphql mutation ReleaseCoreDeleteStalePreviews($fileIds:[ID!]!){fileDelete(fileIds:$fileIds){deletedFileIds userErrors{message}}}`, { variables: { fileIds: shopifyPreviewIds } });
      } catch (error) { console.warn("ReleaseCore: stale MP3 preview cleanup skipped", error); }
    }
    if (stalePreviews.length) await db.releaseFile.deleteMany({ where: { id: { in: stalePreviews.map((item) => item.id) } } });

    const file = await db.releaseFile.create({
      data: {
        releaseId,
        trackId,
        kind: FILE_KINDS.MASTER_WAV,
        filename: descriptor.name,
        storageProvider: "LOCAL_DEV",
        storageKey: savedKey,
        mimeType: descriptor.mime,
        sizeBytes: descriptor.size,
        status: "READY",
      },
    });
    await db.release.update({ where: { id: releaseId }, data: { updatedAt: new Date() } });
    return Response.json({ ok: true, message: `${filename} uploaded as Track ${track.position}'s master.`, file });
  } catch (error) {
    if (savedKey) { try { await deleteLocalStorageKey(savedKey); } catch {} }
    console.error("ReleaseCore: master upload failed", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "ReleaseCore could not upload this master." }, { status: 500 });
  }
};
