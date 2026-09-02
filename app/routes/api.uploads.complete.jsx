import { authenticate } from "../shopify.server";
import db from "../db.server";
import { fileContentTypeForKind, isReplaceableKind, validateUploadDescriptor } from "../lib/releasecore-files";

import { releaseIsEditable } from "../lib/workflow";
import { apiErrorResponse, publicError } from "../lib/http-security.server";
import { findShopRelease } from "../lib/tenant-db.server";
import { deleteShopifyFilesBestEffort } from "../lib/shopify-files.server";
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

    const release = await findShopRelease(session.shop, releaseId, { include: { tracks: true } });
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
    if (payload?.userErrors?.length) throw publicError(payload.userErrors.map((item) => item.message).join(" "), { status: 400 });
    const shopifyFile = payload?.files?.[0];
    if (!shopifyFile?.id) throw new Error("Shopify did not create a file record.");

    const existing = isReplaceableKind(kind)
      ? await db.releaseFile.findMany({
          where: { releaseId, trackId, kind, release: { shop: session.shop } },
        })
      : [];

    const file = await db.$transaction(async (tx) => {
      if (existing.length) {
        await tx.releaseFile.deleteMany({
          where: { id: { in: existing.map((item) => item.id) } },
        });
      }
      const created = await tx.releaseFile.create({
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
      await tx.release.updateMany({
        where: { id: releaseId, shop: session.shop },
        data: { updatedAt: new Date() },
      });
      return created;
    });

    await deleteShopifyFilesBestEffort(
      admin,
      existing
        .filter((item) => item.storageProvider === "SHOPIFY_FILES")
        .map((item) => item.storageKey),
      { context: "replaced upload cleanup" },
    );
    return Response.json({ ok: true, message: `${filename} uploaded.`, file });
  } catch (error) {
    return apiErrorResponse(request, error, { context: "complete upload", fallback: "ReleaseCore could not finalize this upload." });
  }
};
