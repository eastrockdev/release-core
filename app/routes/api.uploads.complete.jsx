import { authenticate } from "../shopify.server";
import db from "../db.server";
import { fileContentTypeForKind, isReplaceableKind, validateUploadDescriptor } from "../lib/releasecore-files";

import { releaseIsEditable } from "../lib/workflow";
async function bestEffortDeleteShopifyFile(admin, fileId) {
  if (!fileId) return;
  try {
    const response = await admin.graphql(
      `#graphql
        mutation ReleaseCoreDeleteReplacedFile($fileIds: [ID!]!) {
          fileDelete(fileIds: $fileIds) { deletedFileIds userErrors { message } }
        }`,
      { variables: { fileIds: [fileId] } },
    );
    const json = await response.json();
    const errors = json?.data?.fileDelete?.userErrors || [];
    if (errors.length) console.warn("ReleaseCore: old Shopify file could not be removed", errors);
  } catch (error) {
    console.warn("ReleaseCore: old Shopify file cleanup failed", error);
  }
}

export const action = async ({ request }) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  try {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const releaseId = String(formData.get("releaseId") || "");
    const trackId = String(formData.get("trackId") || "") || null;
    const kind = String(formData.get("kind") || "");
    const filename = String(formData.get("filename") || "");
    const mimeType = String(formData.get("mimeType") || "");
    const sizeBytes = Number(formData.get("sizeBytes") || 0);
    const resourceUrl = String(formData.get("resourceUrl") || "");

    const release = await db.release.findFirst({ where: { id: releaseId, shop: session.shop }, include: { tracks: true } });
    if (!release) return Response.json({ ok: false, error: "Release not found." }, { status: 404 });
    if (!releaseIsEditable(release.status)) return Response.json({ ok: false, error: "This release is locked while it is under review or finalized." }, { status: 409 });
    if (trackId && !release.tracks.some((track) => track.id === trackId)) return Response.json({ ok: false, error: "Track does not belong to this release." }, { status: 404 });
    const descriptor = validateUploadDescriptor({ kind, filename, mimeType, sizeBytes, trackId });
    if (!resourceUrl) return Response.json({ ok: false, error: "Upload resource URL is missing." }, { status: 400 });

    const input = {
      contentType: fileContentTypeForKind(kind),
      originalSource: resourceUrl,
      ...(kind === "COVER_ART" ? { alt: `${release.title} cover artwork` } : {}),
    };
    const response = await admin.graphql(
      `#graphql
        mutation ReleaseCoreCreateFile($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              id
              fileStatus
              alt
              ... on GenericFile { url }
              ... on MediaImage { image { url width height } }
            }
            userErrors { field message code }
          }
        }`,
      { variables: { files: [input] } },
    );
    const json = await response.json();
    const payload = json?.data?.fileCreate;
    if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((item) => item.message).join(" "));
    const shopifyFile = payload?.files?.[0];
    if (!shopifyFile?.id) throw new Error("Shopify did not create a file record.");

    if (isReplaceableKind(kind)) {
      const existing = await db.releaseFile.findMany({ where: { releaseId, trackId, kind } });
      for (const item of existing) await bestEffortDeleteShopifyFile(admin, item.storageKey);
      if (existing.length) await db.releaseFile.deleteMany({ where: { id: { in: existing.map((item) => item.id) } } });
    }

    const file = await db.releaseFile.create({
      data: {
        releaseId,
        trackId,
        kind,
        filename: descriptor.name,
        storageProvider: "SHOPIFY_FILES",
        storageKey: shopifyFile.id,
        url: shopifyFile.url || shopifyFile.image?.url || null,
        mimeType: descriptor.mime,
        sizeBytes: descriptor.size,
        status: shopifyFile.fileStatus || "UPLOADED",
      },
    });
    await db.release.update({ where: { id: releaseId }, data: { updatedAt: new Date() } });
    return Response.json({ ok: true, message: `${filename} uploaded.`, file });
  } catch (error) {
    console.error("ReleaseCore: complete upload failed", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "ReleaseCore could not finalize this upload." }, { status: 500 });
  }
};
