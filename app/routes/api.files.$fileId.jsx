import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteLocalStorageKey, deleteR2StorageKey } from "../lib/storage.server";
import { releaseIsEditable } from "../lib/workflow";

export const action = async ({ request, params }) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  try {
    const { admin, session } = await authenticate.admin(request);
    const file = await db.releaseFile.findFirst({ where: { id: params.fileId, release: { shop: session.shop } }, include: { release: true } });
    if (!file) return Response.json({ ok: false, error: "File not found." }, { status: 404 });
    if (!releaseIsEditable(file.release.status)) return Response.json({ ok: false, error: "This release is locked while it is under review or finalized." }, { status: 409 });

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
      if (errors.length) throw new Error(errors.map((item) => item.message).join(" "));
    } else if (file.storageProvider === "R2" && file.storageKey) {
      await deleteR2StorageKey(file.storageKey);
    } else if (file.storageProvider === "LOCAL_DEV" && file.storageKey) {
      await deleteLocalStorageKey(file.storageKey);
    }

    await db.releaseFile.delete({ where: { id: file.id } });
    await db.release.update({ where: { id: file.releaseId }, data: { updatedAt: new Date() } });
    return Response.json({ ok: true, message: `${file.filename} removed.` });
  } catch (error) {
    console.error("ReleaseCore: file deletion failed", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "ReleaseCore could not remove this file." }, { status: 500 });
  }
};
