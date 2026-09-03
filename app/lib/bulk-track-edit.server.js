import db from "../db.server";
import { publicError } from "./http-security.server";
import { normalizeIsrc, validateIsrc } from "./isrc";
import { releaseIsEditable } from "./workflow";

function text(value, fallback = null) {
  const clean = String(value ?? "").trim();
  return clean || fallback;
}

function validIsrc(value, track) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (track.isrc) {
      throw publicError(
        `Track ${track.position} already has ISRC ${track.isrc}. Replace it with the correct code instead of clearing it.`,
        { status: 400, code: "ISRC_CLEAR_NOT_ALLOWED" },
      );
    }
    return null;
  }
  try {
    return validateIsrc(raw);
  } catch (error) {
    throw publicError(
      `Track ${track.position}: ${error instanceof Error ? error.message : "Enter a valid ISRC."}`,
      { status: 400, code: "INVALID_ISRC" },
    );
  }
}

export async function bulkUpdateReleaseTracks({
  shop,
  releaseId,
  rows,
  actorLabel = "Shopify admin",
}) {
  if (!Array.isArray(rows) || !rows.length) {
    throw publicError("No track changes were supplied.", { status: 400 });
  }

  const release = await db.release.findFirst({
    where: { id: releaseId, shop },
    include: { tracks: { orderBy: { position: "asc" } } },
  });
  if (!release) throw publicError("Release not found.", { status: 404 });

  const editable = releaseIsEditable(release.status);
  const byId = new Map(release.tracks.map((track) => [track.id, track]));

  const normalized = rows.map((row) => {
    const track = byId.get(String(row?.trackId || ""));
    if (!track) {
      throw publicError("One selected track does not belong to this release.", {
        status: 400,
      });
    }

    const title = text(row?.title, "Untitled Track");
    const version = text(row?.version);
    const language = text(row?.language);
    const explicit = Boolean(row?.explicit);
    const isrc = validIsrc(row?.isrc, track);

    const metadataChanged =
      title !== track.title ||
      (version || null) !== (track.version || null) ||
      (language || null) !== (track.language || null) ||
      explicit !== Boolean(track.explicit);

    const isrcChanged =
      normalizeIsrc(isrc || "") !== normalizeIsrc(track.isrc || "");

    if (!editable && metadataChanged) {
      throw publicError(
        "This release is locked. Reopen it before changing track metadata. Administrators can still correct ISRCs.",
        { status: 409 },
      );
    }

    return {
      track,
      trackId: track.id,
      title,
      version,
      language,
      explicit,
      isrc,
      metadataChanged,
      isrcChanged,
    };
  });

  const desiredCodes = normalized.map((row) => row.isrc).filter(Boolean);
  const repeated = desiredCodes.find(
    (code, index) => desiredCodes.indexOf(code) !== index,
  );
  if (repeated) {
    throw publicError(
      `ISRC ${repeated} appears more than once in this table. Every recording must have a unique ISRC.`,
      { status: 409, code: "ISRC_ALREADY_ASSIGNED" },
    );
  }

  if (desiredCodes.length) {
    const targetIds = normalized.map((row) => row.trackId);
    const conflicts = await db.track.findMany({
      where: {
        isrc: { in: desiredCodes },
        id: { notIn: targetIds },
      },
      include: { release: true },
    });
    if (conflicts.length) {
      const conflict = conflicts[0];
      throw publicError(
        conflict.release?.shop === shop
          ? `ISRC ${conflict.isrc} is already assigned to "${conflict.title || "Untitled Track"}" on "${conflict.release?.title || "Untitled Release"}". If this is the same recording, use Add existing song instead of duplicating it.`
          : `ISRC ${conflict.isrc} is already assigned to another recording.`,
        { status: 409, code: "ISRC_ALREADY_ASSIGNED" },
      );
    }
  }

  const changed = normalized.filter(
    (row) => row.metadataChanged || row.isrcChanged,
  );
  const isrcChanges = changed.filter((row) => row.isrcChanged);
  if (!changed.length) return { changed: 0, isrcCorrections: 0 };

  const now = new Date();
  await db.$transaction(async (tx) => {
    // Clear changing codes first so valid swaps can be committed atomically.
    if (isrcChanges.length) {
      await tx.track.updateMany({
        where: { id: { in: isrcChanges.map((row) => row.trackId) } },
        data: { isrc: null },
      });
    }

    for (const row of changed) {
      const data = {};
      if (editable && row.metadataChanged) {
        data.title = row.title;
        data.version = row.version;
        data.language = row.language;
        data.explicit = row.explicit;
      }
      if (row.isrcChanged) {
        data.isrc = row.isrc;
        data.isrcAssignedAt = now;
      }
      if (Object.keys(data).length) {
        await tx.track.update({ where: { id: row.trackId }, data });
      }
      if (row.isrcChanged) {
        await tx.submissionEvent.create({
          data: {
            releaseId: release.id,
            trackId: row.trackId,
            type: row.track.isrc ? "ISRC_CORRECTED" : "ISRC_ASSIGNED",
            message: row.track.isrc
              ? `Track ${row.track.position} ISRC corrected from ${row.track.isrc} to ${row.isrc} by the distributor in bulk edit.`
              : `Track ${row.track.position} assigned ${row.isrc} manually by the distributor in bulk edit.`,
            actorLabel,
          },
        });
      }
    }

    await tx.release.update({
      where: { id: release.id },
      data: { updatedAt: now },
    });
    await tx.submissionEvent.create({
      data: {
        releaseId: release.id,
        type: "TRACKS_BULK_UPDATED",
        message: `${changed.length} track${changed.length === 1 ? "" : "s"} updated in bulk edit.`,
        actorLabel,
      },
    });
  });

  return {
    changed: changed.length,
    isrcCorrections: isrcChanges.length,
  };
}
