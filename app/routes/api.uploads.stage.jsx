import { authenticate } from "../shopify.server";
import db from "../db.server";
import { stagedResourceForKind, validateUploadDescriptor } from "../lib/releasecore-files";

import { releaseIsEditable } from "../lib/workflow";
export const action = async ({ request }) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  try {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const releaseId = String(formData.get("releaseId") || "");
    const trackId = String(formData.get("trackId") || "");
    const kind = String(formData.get("kind") || "");
    const filename = String(formData.get("filename") || "");
    const mimeType = String(formData.get("mimeType") || "");
    const sizeBytes = Number(formData.get("sizeBytes") || 0);

    const release = await db.release.findFirst({ where: { id: releaseId, shop: session.shop }, include: { tracks: true } });
    if (!release) return Response.json({ ok: false, error: "Release not found." }, { status: 404 });
    if (!releaseIsEditable(release.status)) return Response.json({ ok: false, error: "This release is locked while it is under review or finalized." }, { status: 409 });
    if (trackId && !release.tracks.some((track) => track.id === trackId)) return Response.json({ ok: false, error: "Track does not belong to this release." }, { status: 404 });

    const descriptor = validateUploadDescriptor({ kind, filename, mimeType, sizeBytes, trackId });
    const response = await admin.graphql(
      `#graphql
        mutation ReleaseCoreStageUpload($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          input: [{
            filename: descriptor.name,
            mimeType: descriptor.mime,
            fileSize: String(descriptor.size),
            httpMethod: "POST",
            resource: stagedResourceForKind(kind),
          }],
        },
      },
    );
    const json = await response.json();
    const payload = json?.data?.stagedUploadsCreate;
    if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((item) => item.message).join(" "));
    const target = payload?.stagedTargets?.[0];
    if (!target?.url || !target?.resourceUrl) throw new Error("Shopify did not return a staged upload target.");
    return Response.json({ ok: true, target });
  } catch (error) {
    console.error("ReleaseCore: stage upload failed", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "ReleaseCore could not prepare this upload." }, { status: 500 });
  }
};
