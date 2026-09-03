import db from "../db.server";
import { publicError } from "./http-security.server";
import { deleteMasterStorageObject } from "./storage.server";
import { releaseIsEditable } from "./workflow";

function isAlbumLike(type) {
  return ["EP", "ALBUM"].includes(String(type || "").toUpperCase());
}

function privateMasterFiles(track) {
  return (track?.files || []).filter(
    (file) =>
      file?.kind === "MASTER_WAV" &&
      file?.trackId &&
      file?.storageKey &&
      ["R2", "LOCAL_DEV"].includes(file.storageProvider),
  );
}

export async function attachExistingSingleTrack({
  shop,
  targetReleaseId,
  sourceReleaseId,
}) {
  const [target, source] = await Promise.all([
    db.release.findFirst({
      where: { id: targetReleaseId, shop },
      include: {
        tracks: { orderBy: { position: "asc" } },
      },
    }),
    db.release.findFirst({
      where: { id: sourceReleaseId, shop },
      include: {
        tracks: {
          orderBy: { position: "asc" },
          include: { files: true },
        },
      },
    }),
  ]);

  if (!target) throw publicError("Release not found.", { status: 404 });
  if (!source) throw publicError("Existing song not found.", { status: 404 });

  if (!isAlbumLike(target.type)) {
    throw publicError(
      "Existing songs can only be added to an EP or Album.",
      { status: 409 },
    );
  }

  if (!releaseIsEditable(target.status)) {
    throw publicError(
      "Reopen this release as a draft before changing its tracklist.",
      { status: 409 },
    );
  }

  if (source.id === target.id || String(source.type || "").toUpperCase() !== "SINGLE") {
    throw publicError(
      "Choose an imported Single to add to this release.",
      { status: 400 },
    );
  }

  if (source.shopifyReleaseProductId) {
    throw publicError(
      "That Single has its own release-level Shopify product and cannot be merged automatically.",
      { status: 409 },
    );
  }

  if (source.tracks.length !== 1) {
    throw publicError(
      "Only a one-track Single can be moved into an EP or Album.",
      { status: 409 },
    );
  }

  const track = source.tracks[0];
  if (!track.shopifyProductId) {
    throw publicError(
      "That song is not linked to a Shopify track product yet.",
      { status: 409 },
    );
  }

  if (
    target.tracks.some(
      (item) => item.shopifyProductId === track.shopifyProductId,
    )
  ) {
    throw publicError(
      "That Shopify song is already part of this release.",
      { status: 409 },
    );
  }

  const nextPosition =
    target.tracks.reduce(
      (max, item) => Math.max(max, Number(item.position || 0)),
      0,
    ) + 1;

  await db.$transaction(async (tx) => {
    // Track-scoped files must follow the track to the new parent release.
    await tx.releaseFile.updateMany({
      where: { trackId: track.id },
      data: { releaseId: target.id },
    });

    // Preserve any track-specific change request rather than deleting it with
    // the standalone Single wrapper.
    await tx.releaseReviewItem.updateMany({
      where: { trackId: track.id },
      data: { releaseId: target.id },
    });

    await tx.track.update({
      where: { id: track.id },
      data: {
        releaseId: target.id,
        position: nextPosition,
      },
    });

    await tx.submissionEvent.create({
      data: {
        releaseId: target.id,
        trackId: track.id,
        type: "EXISTING_TRACK_ATTACHED",
        message: `"${track.title || source.title || "Existing song"}" was moved from the imported Single "${source.title || "Untitled Single"}" into this ${String(target.type).toUpperCase()}. Its Shopify song product remains linked.`,
        actorLabel: "Shopify admin",
      },
    });

    await tx.release.update({
      where: { id: target.id },
      data: { updatedAt: new Date() },
    });

    // The Track row now carries the imported Shopify product, ISRC, credits,
    // artists and track files. Removing the empty Release wrapper keeps the
    // duplicate-import guard intact without creating a second catalog record.
    await tx.release.delete({ where: { id: source.id } });
  });

  return {
    trackId: track.id,
    title: track.title || source.title || "Existing song",
    shopifyProductId: track.shopifyProductId,
  };
}

export async function deleteDraftTrack({ shop, releaseId, trackId }) {
  const release = await db.release.findFirst({
    where: { id: releaseId, shop },
    include: {
      tracks: {
        orderBy: { position: "asc" },
        include: { files: true },
      },
    },
  });

  if (!release) throw publicError("Release not found.", { status: 404 });

  if (release.status !== "DRAFT") {
    throw publicError(
      "Tracks can only be permanently deleted from a draft release.",
      { status: 409 },
    );
  }

  const track = release.tracks.find((item) => item.id === trackId);
  if (!track) throw publicError("Track not found.", { status: 404 });

  if (String(release.type || "").toUpperCase() === "SINGLE") {
    throw publicError(
      "A Single must keep its one track. Delete the draft release instead.",
      { status: 409 },
    );
  }

  if (track.shopifyProductId) {
    throw publicError(
      "This track is linked to a Shopify song product and cannot be permanently deleted. Only unlinked draft tracks can be deleted.",
      { status: 409 },
    );
  }

  for (const file of privateMasterFiles(track)) {
    await deleteMasterStorageObject({
      storageProvider: file.storageProvider,
      storageKey: file.storageKey,
      shop,
      releaseId: release.id,
      trackId: track.id,
    });
  }

  await db.$transaction(async (tx) => {
    await tx.track.delete({ where: { id: track.id } });

    const remaining = await tx.track.findMany({
      where: { releaseId: release.id },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });

    for (let index = 0; index < remaining.length; index += 1) {
      const desired = index + 1;
      if (remaining[index].position === desired) continue;
      await tx.track.update({
        where: { id: remaining[index].id },
        data: { position: desired },
      });
    }

    await tx.submissionEvent.create({
      data: {
        releaseId: release.id,
        type: "DRAFT_TRACK_DELETED",
        message: `Draft track ${track.position} "${track.title || "Untitled Track"}" was permanently deleted.`,
        actorLabel: "Shopify admin",
      },
    });

    await tx.release.update({
      where: { id: release.id },
      data: { updatedAt: new Date() },
    });
  });

  return {
    id: track.id,
    title: track.title,
  };
}
