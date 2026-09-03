import db from "../db.server";
import { publicError } from "./http-security.server";
import { deleteMasterStorageObject } from "./storage.server";

function draftWhere({ shop, releaseId, ownerCustomerId = null }) {
  return {
    id: releaseId,
    shop,
    ...(ownerCustomerId ? { ownerCustomerId } : {}),
  };
}

function hasShopifyCatalogLink(release) {
  if (release?.shopifyReleaseProductId) return true;
  return (release?.tracks || []).some((track) => Boolean(track.shopifyProductId));
}

function deletableMasterFiles(release) {
  const files = [
    ...(release?.files || []),
    ...(release?.tracks || []).flatMap((track) => track.files || []),
  ];

  return files.filter(
    (file) =>
      file?.kind === "MASTER_WAV" &&
      file?.trackId &&
      file?.storageKey &&
      ["R2", "LOCAL_DEV"].includes(file.storageProvider),
  );
}

export async function deleteReleaseDraft({
  shop,
  releaseId,
  ownerCustomerId = null,
}) {
  const release = await db.release.findFirst({
    where: draftWhere({ shop, releaseId, ownerCustomerId }),
    include: {
      files: true,
      tracks: {
        include: { files: true },
      },
    },
  });

  if (!release) {
    throw publicError("Release not found.", { status: 404 });
  }

  if (release.status !== "DRAFT") {
    throw publicError("Only a draft release can be deleted.", { status: 409 });
  }

  // A reopened submission is still part of the permanent release workflow.
  // M14.4.1 intentionally limits destructive deletion to never-submitted drafts.
  if (release.submittedAt || release.lastSubmittedAt) {
    throw publicError(
      "This draft was previously submitted and cannot be permanently deleted. Keep it as a draft or continue the review workflow.",
      { status: 409 },
    );
  }

  // Never silently orphan a Shopify catalog product. Imported or published
  // products must be handled deliberately from the catalog/distribution tools.
  if (hasShopifyCatalogLink(release)) {
    throw publicError(
      "This draft is linked to a Shopify product and cannot be deleted from ReleaseCore until that catalog relationship is intentionally handled.",
      { status: 409 },
    );
  }

  // Private masters belong to ReleaseCore storage, so remove them before the
  // database cascade. Shopify Files/artwork are merchant-owned and are left in
  // Shopify rather than destructively deleting merchant media.
  for (const file of deletableMasterFiles(release)) {
    await deleteMasterStorageObject({
      storageProvider: file.storageProvider,
      storageKey: file.storageKey,
      shop,
      releaseId: release.id,
      trackId: file.trackId,
    });
  }

  await db.release.delete({ where: { id: release.id } });

  return {
    id: release.id,
    title: release.title,
  };
}
