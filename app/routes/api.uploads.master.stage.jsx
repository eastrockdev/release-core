import { authenticate } from "../shopify.server";
import { FILE_KINDS, validateUploadDescriptor } from "../lib/releasecore-files";
import { createR2MasterUploadTarget } from "../lib/storage.server";
import { releaseIsEditable } from "../lib/workflow";
import { apiErrorResponse } from "../lib/http-security.server";
import { findShopRelease } from "../lib/tenant-db.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const releaseId = String(formData.get("releaseId") || "");
    const trackId = String(formData.get("trackId") || "");
    const filename = String(formData.get("filename") || "master.wav");
    const mimeType = String(formData.get("mimeType") || "audio/wav");
    const sizeBytes = Number(formData.get("sizeBytes") || 0);

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
    if (!release.tracks.some((track) => track.id === trackId)) {
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

    const target = await createR2MasterUploadTarget({
      shop: session.shop,
      releaseId,
      trackId,
      filename: descriptor.name,
      mimeType: descriptor.mime,
      sizeBytes: descriptor.size,
    });

    return Response.json({ ok: true, target });
  } catch (error) {
    return apiErrorResponse(request, error, { context: "master upload staging", fallback: "ReleaseCore could not prepare this master upload." });
  }
};
