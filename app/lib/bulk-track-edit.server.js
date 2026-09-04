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

function validExpectedTrackMetadataVersion(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const version = Number(raw);
  if (
    !Number.isInteger(version) ||
    version < 0
  ) {
    throw publicError(
      "This track editor has invalid metadata version information. Reload the track before saving.",
      { status: 409, code: "EDIT_CONFLICT" },
    );
  }
  return version;
}

function validPosition(value, trackCount, track) {
  const position = Number(value ?? track.position);
  if (
    !Number.isInteger(position) ||
    position < 1 ||
    position > trackCount
  ) {
    throw publicError(
      `Track ${track.position}: position must be a whole number from 1 to ${trackCount}.`,
      { status: 400, code: "INVALID_TRACK_POSITION" },
    );
  }
  return position;
}

export async function bulkUpdateReleaseTracks({
  shop,
  releaseId,
  rows,
  expectedTrackMetadataVersion = null,
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
  const expectedTrackVersion =
    validExpectedTrackMetadataVersion(
      expectedTrackMetadataVersion,
    );
  const byId = new Map(release.tracks.map((track) => [track.id, track]));
  const seen = new Set();

  const normalized = rows.map((row) => {
    const trackId = String(row?.trackId || "");
    if (seen.has(trackId)) {
      throw publicError(
        "The track editor submitted the same track more than once.",
        { status: 400 },
      );
    }
    seen.add(trackId);

    const track = byId.get(trackId);
    if (!track) {
      throw publicError("One selected track does not belong to this release.", {
        status: 400,
      });
    }

    const position = validPosition(
      row?.position,
      release.tracks.length,
      track,
    );
    const title = text(row?.title, "Untitled Track");
    const version = text(row?.version);
    const language = text(row?.language);
    const explicit = Boolean(row?.explicit);
    const lyrics = text(row?.lyrics);
    const isrc = validIsrc(row?.isrc, track);
    const rowExpectedTrackMetadataVersion =
      validExpectedTrackMetadataVersion(
        row?.expectedTrackMetadataVersion,
      );

    const metadataChanged =
      position !== track.position ||
      title !== track.title ||
      (version || null) !== (track.version || null) ||
      (language || null) !== (track.language || null) ||
      explicit !== Boolean(track.explicit) ||
      (lyrics || null) !== (track.lyrics || null);

    const isrcChanged =
      normalizeIsrc(isrc || "") !== normalizeIsrc(track.isrc || "");

    if (!editable && metadataChanged) {
      throw publicError(
        "This release is locked. Reopen it before changing track metadata. Administrators can still correct ISRCs in the Track editor.",
        { status: 409 },
      );
    }

    return {
      track,
      trackId: track.id,
      position,
      title,
      version,
      language,
      explicit,
      lyrics,
      isrc,
      expectedTrackMetadataVersion:
        rowExpectedTrackMetadataVersion,
      metadataChanged,
      isrcChanged,
      positionChanged: position !== track.position,
    };
  });

  const positionChanges = normalized.filter((row) => row.positionChanged);
  if (positionChanges.length) {
    const desiredPositionById = new Map(
      release.tracks.map((track) => [track.id, track.position]),
    );
    for (const row of positionChanges) {
      desiredPositionById.set(row.trackId, row.position);
    }

    const desiredPositions = [...desiredPositionById.values()];
    if (new Set(desiredPositions).size !== desiredPositions.length) {
      throw publicError(
        "Every track must have a unique position.",
        { status: 400, code: "DUPLICATE_TRACK_POSITION" },
      );
    }

    const sorted = [...desiredPositions].sort((a, b) => a - b);
    const completeSequence = sorted.every(
      (position, index) => position === index + 1,
    );
    if (!completeSequence) {
      throw publicError(
        `Track positions must use every number from 1 to ${release.tracks.length}.`,
        { status: 400, code: "INVALID_TRACK_POSITION_SEQUENCE" },
      );
    }
  }

  const desiredCodes = normalized.map((row) => row.isrc).filter(Boolean);
  const repeated = desiredCodes.find(
    (code, index) => desiredCodes.indexOf(code) !== index,
  );
  if (repeated) {
    throw publicError(
      `ISRC ${repeated} appears more than once in this editor. Every recording must have a unique ISRC.`,
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
  if (!changed.length) {
    return {
      changed: 0,
      isrcCorrections: 0,
      reordered: false,
    };
  }

  const hasRowScopedConcurrency = normalized.some(
    (row) => row.expectedTrackMetadataVersion !== null,
  );
  if (
    hasRowScopedConcurrency &&
    normalized.some(
      (row) => row.expectedTrackMetadataVersion === null,
    )
  ) {
    throw publicError(
      "This bulk track editor has incomplete metadata version information. Reload the latest track values before saving again.",
      { status: 409, code: "EDIT_CONFLICT" },
    );
  }

  if (
    normalized.length > 1 &&
    !hasRowScopedConcurrency
  ) {
    throw publicError(
      "This bulk track editor is using outdated concurrency information. Reload the latest track values before saving again.",
      { status: 409, code: "EDIT_CONFLICT" },
    );
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    for (const row of changed) {
      const expectedVersion =
        row.expectedTrackMetadataVersion ??
        (normalized.length === 1
          ? expectedTrackVersion
          : null);

      if (expectedVersion === null) continue;

      const claimed = await tx.track.updateMany({
        where: {
          id: row.trackId,
          releaseId: release.id,
          metadataVersion: expectedVersion,
        },
        data: {
          metadataVersion: { increment: 1 },
        },
      });

      if (claimed.count !== 1) {
        throw publicError(
          `Track ${row.track.position} information changed since this editor loaded. Reload and review the latest metadata before saving again.`,
          { status: 409, code: "EDIT_CONFLICT" },
        );
      }
    }

    // Move only tracks whose order changed to temporary negative positions.
    // This keeps @@unique([releaseId, position]) valid during swaps without
    // touching tracks that were not part of the reorder.
    if (positionChanges.length) {
      for (const [index, row] of positionChanges.entries()) {
        await tx.track.update({
          where: { id: row.trackId },
          data: { position: -(index + 1) },
        });
      }
    }

    // Clear changing codes first so valid ISRC swaps can be committed atomically.
    if (isrcChanges.length) {
      await tx.track.updateMany({
        where: { id: { in: isrcChanges.map((row) => row.trackId) } },
        data: { isrc: null },
      });
    }

    for (const row of normalized) {
      const data = {};

      if (editable && row.metadataChanged) {
        data.title = row.title;
        data.version = row.version;
        data.language = row.language;
        data.explicit = row.explicit;
        data.lyrics = row.lyrics;
      }

      if (editable && row.positionChanged) {
        data.position = row.position;
      }

      if (row.isrcChanged) {
        data.isrc = row.isrc;
        data.isrcAssignedAt = now;
      }

      if (Object.keys(data).length) {
        await tx.track.update({
          where: { id: row.trackId },
          data,
        });
      }

      if (row.isrcChanged) {
        await tx.submissionEvent.create({
          data: {
            releaseId: release.id,
            trackId: row.trackId,
            type: row.track.isrc ? "ISRC_CORRECTED" : "ISRC_ASSIGNED",
            message: row.track.isrc
              ? `Track ${row.track.position} ISRC corrected from ${row.track.isrc} to ${row.isrc} by the distributor in the Track editor.`
              : `Track ${row.track.position} assigned ${row.isrc} manually by the distributor in the Track editor.`,
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
        message: `${changed.length} track${changed.length === 1 ? "" : "s"} updated in the dedicated Track editor${positionChanges.length ? "; track order updated" : ""}.`,
        actorLabel,
      },
    });
  });

  return {
    changed: changed.length,
    isrcCorrections: isrcChanges.length,
    reordered: Boolean(positionChanges.length),
  };
}
