import { authenticate } from "../shopify.server";
import db from "../db.server";
import { FILE_KINDS, validateUploadDescriptor } from "../lib/releasecore-files";
import {
  abortR2MultipartMasterUpload,
  completeR2MultipartMasterUpload,
  deleteMasterStorageObject,
  verifyR2MasterObject,
} from "../lib/storage.server";
import { releaseIsEditable } from "../lib/workflow";
import { apiErrorResponse, publicError } from "../lib/http-security.server";
import { findShopRelease } from "../lib/tenant-db.server";
import { deleteShopifyFilesBestEffort } from "../lib/shopify-files.server";

async function deleteStoredMaster(file, scope) {
  if (!file?.storageKey) return;
  await deleteMasterStorageObject({
    storageProvider: file.storageProvider,
    storageKey: file.storageKey,
    ...scope,
  });
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  let newStorageKey = null;
  let uploadScope = null;
  let multipartUploadId = null;
  let multipartCompleted = false;
  let committed = false;

  try {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const releaseId = String(formData.get("releaseId") || "");
    const trackId = String(formData.get("trackId") || "");
    const filename = String(formData.get("filename") || "master.wav");
    const mimeType = String(formData.get("mimeType") || "audio/wav");
    const sizeBytes = Number(formData.get("sizeBytes") || 0);
    const storageKey = String(formData.get("storageKey") || "");
    const intent = String(formData.get("intent") || "complete");
    const uploadMode = String(formData.get("uploadMode") || "SINGLE_PUT");
    const uploadId = String(formData.get("uploadId") || "");
    newStorageKey = storageKey;
    multipartUploadId = uploadId;
    uploadScope = { shop: session.shop, releaseId, trackId, storageKey };

    const release = await findShopRelease(session.shop, releaseId, { include: { tracks: true } });

    if (!release) {
      return Response.json({ ok: false, error: "Release not found." }, { status: 404 });
    }
    if (!releaseIsEditable(release.status)) {
      return Response.json(
        { ok: false, error: "This release is locked while it is under review or finalized." },
        { status: 409 },
      );
    }
    const track = release.tracks.find((item) => item.id === trackId);
    if (!track) {
      return Response.json(
        { ok: false, error: "Track does not belong to this release." },
        { status: 404 },
      );
    }

    const descriptor = validateUploadDescriptor({
      kind: FILE_KINDS.MASTER_WAV,
      filename,
      mimeType,
      sizeBytes,
      trackId,
    });

    if (!storageKey) {
      return Response.json(
        { ok: false, error: "The master upload session is incomplete. Please upload the file again." },
        { status: 400 },
      );
    }

    if (intent === "abort") {
      if (!uploadId) {
        return Response.json(
          { ok: false, error: "The multipart upload ID is missing." },
          { status: 400 },
        );
      }
      await abortR2MultipartMasterUpload({
        shop: session.shop,
        releaseId,
        trackId,
        storageKey,
        uploadId,
      });
      return Response.json({ ok: true, aborted: true });
    }

    if (uploadMode === "MULTIPART") {
      if (!uploadId) throw publicError("The master upload session is incomplete. Please retry the upload.", { status: 400 });
      let parts;
      try {
        parts = JSON.parse(String(formData.get("parts") || "[]"));
      } catch {
        throw publicError("The master upload could not be finalized. Please retry the upload.", { status: 400 });
      }
      await completeR2MultipartMasterUpload({
        shop: session.shop,
        releaseId,
        trackId,
        storageKey,
        uploadId,
        parts,
        expectedSize: descriptor.size,
      });
      multipartCompleted = true;
    }

    const verified = await verifyR2MasterObject({
      shop: session.shop,
      releaseId,
      trackId,
      storageKey,
      expectedSize: descriptor.size,
      expectedMimeType: descriptor.mime,
    });

    const existing = await db.releaseFile.findMany({
      where: { releaseId, trackId, kind: FILE_KINDS.MASTER_WAV, release: { shop: session.shop } },
    });

    const stalePreviews = await db.releaseFile.findMany({
      where: { releaseId, trackId, kind: FILE_KINDS.PREVIEW_MP3, release: { shop: session.shop } },
    });

    const file = await db.$transaction(async (tx) => {
      if (existing.length) {
        await tx.releaseFile.deleteMany({
          where: { id: { in: existing.map((item) => item.id) } },
        });
      }
      if (stalePreviews.length) {
        await tx.releaseFile.deleteMany({
          where: { id: { in: stalePreviews.map((item) => item.id) } },
        });
      }

      const created = await tx.releaseFile.create({
        data: {
          releaseId,
          trackId,
          kind: FILE_KINDS.MASTER_WAV,
          filename: descriptor.name,
          storageProvider: "R2",
          storageKey,
          mimeType: verified.mimeType || descriptor.mime,
          sizeBytes: verified.sizeBytes,
          status: "READY",
        },
      });

      await tx.release.updateMany({
        where: { id: releaseId, shop: session.shop },
        data: { updatedAt: new Date() },
      });

      return created;
    });

    committed = true;

    for (const old of existing) {
      try {
        await deleteStoredMaster(old, { shop: session.shop, releaseId, trackId });
      } catch (error) {
        console.warn("ReleaseCore: replaced master cleanup skipped", error);
      }
    }

    await deleteShopifyFilesBestEffort(
      admin,
      stalePreviews
        .filter((preview) => preview.storageProvider === "SHOPIFY_FILES")
        .map((preview) => preview.storageKey),
      { context: "stale preview cleanup" },
    );

    return Response.json({
      ok: true,
      message: `${filename} uploaded as Track ${track.position}'s master.`,
      file,
    });
  } catch (error) {
    if (multipartUploadId && uploadScope && !multipartCompleted) {
      try {
        await abortR2MultipartMasterUpload({
          ...uploadScope,
          uploadId: multipartUploadId,
        });
      } catch { /* Intentionally ignored: best-effort cleanup or fallback. */ }
    }
    if (newStorageKey && !committed && (!multipartUploadId || multipartCompleted)) {
      try {
        await deleteMasterStorageObject({
          storageProvider: "R2",
          storageKey: newStorageKey,
          shop: uploadScope.shop,
          releaseId: uploadScope.releaseId,
          trackId: uploadScope.trackId,
        });
      } catch { /* Intentionally ignored: best-effort cleanup or fallback. */ }
    }

    return apiErrorResponse(request, error, { context: "master upload completion", fallback: "ReleaseCore could not finalize this master upload." });
  }
};
