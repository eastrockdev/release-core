import { authenticate } from "../shopify.server";
import db from "../db.server";
import { FILE_KINDS, validateUploadDescriptor } from "../lib/releasecore-files";
import { deleteMasterStorageObject, masterStorageProvider, saveMasterStream } from "../lib/storage.server";

import { releaseIsEditable } from "../lib/workflow";
import { apiErrorResponse } from "../lib/http-security.server";
import { findShopRelease } from "../lib/tenant-db.server";
import { deleteShopifyFilesBestEffort } from "../lib/shopify-files.server";
export const action = async ({ request }) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  let savedKey = null;
  let uploadScope = null;
  try {
    const { admin, session } = await authenticate.admin(request);
    if (masterStorageProvider() !== "LOCAL_DEV") {
      return Response.json({ ok: false, error: "Direct master uploads are unavailable. Retry the staged upload." }, { status: 409 });
    }
    const url = new URL(request.url);
    const releaseId = url.searchParams.get("releaseId") || "";
    const trackId = url.searchParams.get("trackId") || "";
    const filename = decodeURIComponent(url.searchParams.get("filename") || "master.wav");
    uploadScope = { shop: session.shop, releaseId, trackId };
    const mimeType = request.headers.get("content-type") || "audio/wav";
    const sizeBytes = Number(request.headers.get("x-releasecore-size") || request.headers.get("content-length") || 0);

    const release = await findShopRelease(session.shop, releaseId, { include: { tracks: true } });
    if (!release) return Response.json({ ok: false, error: "Release not found." }, { status: 404 });
    if (!releaseIsEditable(release.status)) return Response.json({ ok: false, error: "This release is locked while it is under review or finalized." }, { status: 409 });
    const track = release.tracks.find((item) => item.id === trackId);
    if (!track) return Response.json({ ok: false, error: "Track does not belong to this release." }, { status: 404 });
    const descriptor = validateUploadDescriptor({ kind: FILE_KINDS.MASTER_WAV, filename, mimeType, sizeBytes, trackId });

    savedKey = await saveMasterStream({ stream: request.body, shop: session.shop, releaseId, trackId, filename: descriptor.name });
    const existing = await db.releaseFile.findMany({ where: { releaseId, trackId, kind: FILE_KINDS.MASTER_WAV, release: { shop: session.shop } } });
    for (const item of existing) {
      if (!item.storageKey || !["R2", "LOCAL_DEV"].includes(item.storageProvider)) continue;
      await deleteMasterStorageObject({
        storageProvider: item.storageProvider,
        storageKey: item.storageKey,
        shop: session.shop,
        releaseId,
        trackId,
      });
    }
    if (existing.length) await db.releaseFile.deleteMany({ where: { id: { in: existing.map((item) => item.id) } } });

    const stalePreviews = await db.releaseFile.findMany({ where: { releaseId, trackId, kind: FILE_KINDS.PREVIEW_MP3, release: { shop: session.shop } } });
    const shopifyPreviewIds = stalePreviews
      .filter((item) => item.storageProvider === "SHOPIFY_FILES" && item.storageKey)
      .map((item) => item.storageKey);
    await deleteShopifyFilesBestEffort(admin, shopifyPreviewIds, {
      context: "local master stale preview cleanup",
    });
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
    await db.release.updateMany({ where: { id: releaseId, shop: session.shop }, data: { updatedAt: new Date() } });
    return Response.json({ ok: true, message: `${filename} uploaded as Track ${track.position}'s master.`, file });
  } catch (error) {
    if (savedKey) {
      try {
        await deleteMasterStorageObject({
          storageProvider: "LOCAL_DEV",
          storageKey: savedKey,
          ...uploadScope,
        });
      } catch {
        // Best-effort cleanup after a failed local-development upload.
      }
    }
    return apiErrorResponse(request, error, { context: "master upload", fallback: "ReleaseCore could not upload this master." });
  }
};
