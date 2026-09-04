import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteMasterStorageObject } from "../lib/storage.server";
import { releaseIsEditable } from "../lib/workflow";
import { apiErrorResponse, publicError } from "../lib/http-security.server";
import { findShopReleaseFile } from "../lib/tenant-db.server";
import { claimHighImpactMutation } from "../lib/production-safety.server";

export const action = async ({ request, params }) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  try {
    const { admin, session } = await authenticate.admin(request);
    const file = await findShopReleaseFile(session.shop, params.fileId, { include: { release: true } });
    if (!file) return Response.json({ ok: false, error: "File not found." }, { status: 404 });
    if (!releaseIsEditable(file.release.status)) return Response.json({ ok: false, error: "This release is locked while it is under review or finalized." }, { status: 409 });

    await claimHighImpactMutation({
      request,
      shop: session.shop,
      operation: "delete-file",
      entityType: "RELEASE_FILE",
      entityId: file.id,
    });

    if (file.storageProvider === "SHOPIFY_FILES" && file.storageKey) {
      const response = await admin.graphql(
        `#graphql
          mutation ReleaseCoreDeleteFile($fileIds: [ID!]!) {
            fileDelete(fileIds: $fileIds) { deletedFileIds userErrors { field message code } }
          }`,
        { variables: { fileIds: [file.storageKey] } },
      );
      const json = await response.json();
      const errors = json?.data?.fileDelete?.userErrors || [];
      if (errors.length) throw publicError(errors.map((item) => item.message).join(" "), { status: 409 });
    } else if (["R2", "LOCAL_DEV"].includes(file.storageProvider) && file.storageKey) {
      if (!file.trackId) throw new Error("Stored master is missing its track scope.");
      await deleteMasterStorageObject({
        storageProvider: file.storageProvider,
        storageKey: file.storageKey,
        shop: session.shop,
        releaseId: file.releaseId,
        trackId: file.trackId,
      });
    }

    await db.$transaction([
      db.releaseFile.delete({ where: { id: file.id } }),
      db.release.updateMany({
        where: { id: file.releaseId, shop: session.shop },
        data: { updatedAt: new Date() },
      }),
    ]);
    return Response.json({ ok: true, message: `${file.filename} removed.` });
  } catch (error) {
    return apiErrorResponse(request, error, { context: "file deletion", fallback: "ReleaseCore could not remove this file." });
  }
};
