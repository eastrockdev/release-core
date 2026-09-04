import db from "../db.server";
import { publicError } from "./http-security.server";
import {
  catalogRelationshipDefinition,
  isCatalogRelationshipType,
  isRecordingRelationshipType,
  recordingRelationshipDefinition,
} from "./catalog-relationships";

function clean(value, max = 800) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizedTitle(value) {
  return clean(value, 240)
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isUniqueConstraintError(error) {
  return error?.code === "P2002";
}

function releaseSummary(release) {
  return {
    id: release.id,
    title: release.title,
    type: release.type,
    artistName: release.artistName || null,
    status: release.status,
    distributionStatus: release.distributionStatus,
    releaseDate: release.releaseDate,
    catalogNumber: release.catalogNumber || null,
    upc: release.upc || null,
    trackCount:
      release._count?.tracks ??
      release.tracks?.length ??
      0,
  };
}

function trackSummary(track) {
  return {
    id: track.id,
    position: track.position,
    title: track.title,
    version: track.version || null,
    isrc: track.isrc || null,
  };
}

async function ownedRelease(tx, shop, releaseId, include = {}) {
  const release = await tx.release.findFirst({
    where: { id: releaseId, shop },
    include,
  });

  if (!release) {
    throw publicError("Release not found.", {
      status: 404,
    });
  }

  return release;
}

async function seedTrackLineage(tx, relationship) {
  const [tracks, relatedTracks] = await Promise.all([
    tx.track.findMany({
      where: { releaseId: relationship.releaseId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        position: true,
        title: true,
      },
    }),
    tx.track.findMany({
      where: { releaseId: relationship.relatedReleaseId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        position: true,
        title: true,
      },
    }),
  ]);

  const available = new Map(
    relatedTracks.map((track) => [track.id, track]),
  );
  const rows = [];

  for (const track of tracks) {
    const exactTitleMatches = [...available.values()].filter(
      (candidate) =>
        normalizedTitle(candidate.title) ===
        normalizedTitle(track.title),
    );

    let match =
      exactTitleMatches.find(
        (candidate) =>
          Number(candidate.position) ===
          Number(track.position),
      ) ||
      (exactTitleMatches.length === 1
        ? exactTitleMatches[0]
        : null);

    if (!match) {
      const positionMatch = [...available.values()].find(
        (candidate) =>
          Number(candidate.position) ===
          Number(track.position),
      );
      if (
        positionMatch &&
        normalizedTitle(positionMatch.title) ===
          normalizedTitle(track.title)
      ) {
        match = positionMatch;
      }
    }

    if (!match) continue;

    rows.push({
      shop: relationship.shop,
      releaseRelationshipId: relationship.id,
      trackId: track.id,
      relatedTrackId: match.id,
      recordingRelationship: "UNKNOWN",
    });
    available.delete(match.id);
  }

  if (rows.length) {
    await tx.trackRelationship.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }

  return rows.length;
}

export async function createCatalogRelationship({
  shop,
  releaseId,
  relatedReleaseId,
  relationshipType,
  notes = "",
  actorLabel = "Shopify admin",
}) {
  const type = String(relationshipType || "");
  if (!isCatalogRelationshipType(type)) {
    throw publicError(
      "Choose a valid catalog relationship type.",
      { status: 400 },
    );
  }

  if (!relatedReleaseId || releaseId === relatedReleaseId) {
    throw publicError(
      "A release cannot be related to itself.",
      { status: 400 },
    );
  }

  try {
    return await db.$transaction(async (tx) => {
      const [release, relatedRelease] = await Promise.all([
        ownedRelease(tx, shop, releaseId),
        ownedRelease(tx, shop, relatedReleaseId),
      ]);

      const reverse = await tx.releaseRelationship.findFirst({
        where: {
          shop,
          releaseId: relatedRelease.id,
          relatedReleaseId: release.id,
        },
        select: { id: true },
      });

      if (reverse) {
        throw publicError(
          "This relationship would create a direct catalog cycle. Remove or edit the reverse relationship first.",
          { status: 409 },
        );
      }

      const relationship = await tx.releaseRelationship.create({
        data: {
          shop,
          releaseId: release.id,
          relatedReleaseId: relatedRelease.id,
          relationshipType: type,
          notes: clean(notes, 800) || null,
        },
      });

      const seededTracks = await seedTrackLineage(
        tx,
        relationship,
      );
      const definition =
        catalogRelationshipDefinition(type);

      await tx.submissionEvent.create({
        data: {
          releaseId: release.id,
          type: "CATALOG_RELATIONSHIP_ADDED",
          message:
            `${release.title} marked as ${definition.label.toLowerCase()} “${relatedRelease.title}”.` +
            (seededTracks
              ? ` ${seededTracks} track mapping${seededTracks === 1 ? "" : "s"} seeded for review.`
              : ""),
          actorLabel,
        },
      });

      return {
        id: relationship.id,
        relationshipType: relationship.relationshipType,
        seededTracks,
      };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw publicError(
        "That catalog relationship already exists.",
        { status: 409 },
      );
    }
    throw error;
  }
}

export async function updateCatalogRelationship({
  shop,
  releaseId,
  relationshipId,
  relationshipType,
  notes = "",
  actorLabel = "Shopify admin",
}) {
  const type = String(relationshipType || "");
  if (!isCatalogRelationshipType(type)) {
    throw publicError(
      "Choose a valid catalog relationship type.",
      { status: 400 },
    );
  }

  return db.$transaction(async (tx) => {
    const relationship =
      await tx.releaseRelationship.findFirst({
        where: {
          id: relationshipId,
          shop,
          releaseId,
        },
        include: {
          release: {
            select: { title: true },
          },
          relatedRelease: {
            select: { title: true },
          },
        },
      });

    if (!relationship) {
      throw publicError(
        "Catalog relationship not found.",
        { status: 404 },
      );
    }

    const updated =
      await tx.releaseRelationship.update({
        where: { id: relationship.id },
        data: {
          relationshipType: type,
          notes: clean(notes, 800) || null,
        },
      });

    const definition =
      catalogRelationshipDefinition(type);

    await tx.submissionEvent.create({
      data: {
        releaseId,
        type: "CATALOG_RELATIONSHIP_UPDATED",
        message: `Catalog relationship updated: ${definition.label} “${relationship.relatedRelease.title}”.`,
        actorLabel,
      },
    });

    return updated;
  });
}

export async function deleteCatalogRelationship({
  shop,
  releaseId,
  relationshipId,
  actorLabel = "Shopify admin",
}) {
  return db.$transaction(async (tx) => {
    const relationship =
      await tx.releaseRelationship.findFirst({
        where: {
          id: relationshipId,
          shop,
          releaseId,
        },
        include: {
          relatedRelease: {
            select: {
              title: true,
            },
          },
        },
      });

    if (!relationship) {
      throw publicError(
        "Catalog relationship not found.",
        { status: 404 },
      );
    }

    await tx.releaseRelationship.delete({
      where: { id: relationship.id },
    });

    await tx.submissionEvent.create({
      data: {
        releaseId,
        type: "CATALOG_RELATIONSHIP_REMOVED",
        message: `Catalog relationship to “${relationship.relatedRelease.title}” removed.`,
        actorLabel,
      },
    });

    return {
      id: relationship.id,
      relatedTitle:
        relationship.relatedRelease.title,
    };
  });
}

export async function setTrackRecordingRelationship({
  shop,
  releaseId,
  releaseRelationshipId,
  trackId,
  relatedTrackId,
  recordingRelationship,
  notes = "",
  actorLabel = "Shopify admin",
}) {
  const kind = String(recordingRelationship || "");
  if (!isRecordingRelationshipType(kind)) {
    throw publicError(
      "Choose a valid recording relationship.",
      { status: 400 },
    );
  }

  return db.$transaction(async (tx) => {
    const relationship =
      await tx.releaseRelationship.findFirst({
        where: {
          id: releaseRelationshipId,
          shop,
          releaseId,
        },
        select: {
          id: true,
          releaseId: true,
          relatedReleaseId: true,
        },
      });

    if (!relationship) {
      throw publicError(
        "Catalog relationship not found.",
        { status: 404 },
      );
    }

    const [track, relatedTrack] = await Promise.all([
      tx.track.findFirst({
        where: {
          id: trackId,
          releaseId: relationship.releaseId,
        },
        select: {
          id: true,
          title: true,
          position: true,
          isrc: true,
        },
      }),
      tx.track.findFirst({
        where: {
          id: relatedTrackId,
          releaseId: relationship.relatedReleaseId,
        },
        select: {
          id: true,
          title: true,
          position: true,
          isrc: true,
        },
      }),
    ]);

    if (!track || !relatedTrack) {
      throw publicError(
        "Choose tracks that belong to the two related releases.",
        { status: 400 },
      );
    }

    const mapping = await tx.trackRelationship.upsert({
      where: {
        releaseRelationshipId_trackId: {
          releaseRelationshipId:
            relationship.id,
          trackId: track.id,
        },
      },
      create: {
        shop,
        releaseRelationshipId:
          relationship.id,
        trackId: track.id,
        relatedTrackId: relatedTrack.id,
        recordingRelationship: kind,
        notes: clean(notes, 600) || null,
      },
      update: {
        relatedTrackId: relatedTrack.id,
        recordingRelationship: kind,
        notes: clean(notes, 600) || null,
      },
    });

    const definition =
      recordingRelationshipDefinition(kind);

    await tx.submissionEvent.create({
      data: {
        releaseId,
        trackId: track.id,
        type: "RECORDING_LINEAGE_UPDATED",
        message: `Track ${track.position} “${track.title}” mapped to source track ${relatedTrack.position} “${relatedTrack.title}” as ${definition.label.toLowerCase()}.`,
        actorLabel,
      },
    });

    return mapping;
  });
}

export async function deleteTrackRecordingRelationship({
  shop,
  releaseId,
  releaseRelationshipId,
  trackId,
  actorLabel = "Shopify admin",
}) {
  return db.$transaction(async (tx) => {
    const mapping =
      await tx.trackRelationship.findFirst({
        where: {
          shop,
          releaseRelationshipId,
          trackId,
          releaseRelationship: {
            releaseId,
            shop,
          },
        },
        include: {
          track: {
            select: {
              title: true,
              position: true,
            },
          },
        },
      });

    if (!mapping) {
      throw publicError(
        "Track lineage mapping not found.",
        { status: 404 },
      );
    }

    await tx.trackRelationship.delete({
      where: { id: mapping.id },
    });

    await tx.submissionEvent.create({
      data: {
        releaseId,
        trackId,
        type: "RECORDING_LINEAGE_REMOVED",
        message: `Recording lineage removed for track ${mapping.track.position} “${mapping.track.title}”.`,
        actorLabel,
      },
    });

    return { id: mapping.id };
  });
}

export async function loadCatalogRelationshipWorkspace({
  shop,
  releaseId,
  query = "",
  candidateLimit = 100,
}) {
  const q = clean(query, 120);
  const take = Math.min(
    250,
    Math.max(25, Number(candidateLimit) || 100),
  );

  const releaseSelect = {
    id: true,
    title: true,
    type: true,
    artistName: true,
    status: true,
    distributionStatus: true,
    releaseDate: true,
    catalogNumber: true,
    upc: true,
    tracks: {
      orderBy: { position: "asc" },
      select: {
        id: true,
        position: true,
        title: true,
        version: true,
        isrc: true,
      },
    },
  };

  const [
    release,
    relationships,
    incoming,
    candidatesRaw,
  ] = await Promise.all([
    db.release.findFirst({
      where: { id: releaseId, shop },
      select: releaseSelect,
    }),
    db.releaseRelationship.findMany({
      where: {
        shop,
        releaseId,
      },
      orderBy: { updatedAt: "desc" },
      include: {
        relatedRelease: {
          select: releaseSelect,
        },
        trackRelationships: {
          include: {
            track: {
              select: {
                id: true,
                position: true,
                title: true,
                version: true,
                isrc: true,
              },
            },
            relatedTrack: {
              select: {
                id: true,
                position: true,
                title: true,
                version: true,
                isrc: true,
              },
            },
          },
        },
      },
    }),
    db.releaseRelationship.findMany({
      where: {
        shop,
        relatedReleaseId: releaseId,
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        release: {
          select: {
            id: true,
            title: true,
            type: true,
            artistName: true,
            status: true,
            releaseDate: true,
          },
        },
      },
    }),
    db.release.findMany({
      where: {
        shop,
        id: { not: releaseId },
        ...(q
          ? {
              OR: [
                {
                  title: {
                    contains: q,
                    mode: "insensitive",
                  },
                },
                {
                  artistName: {
                    contains: q,
                    mode: "insensitive",
                  },
                },
                {
                  catalogNumber: {
                    contains: q,
                    mode: "insensitive",
                  },
                },
                {
                  upc: {
                    contains: q,
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [
        { updatedAt: "desc" },
        { title: "asc" },
      ],
      take: take + 1,
      select: {
        id: true,
        title: true,
        type: true,
        artistName: true,
        status: true,
        distributionStatus: true,
        releaseDate: true,
        catalogNumber: true,
        upc: true,
        _count: {
          select: { tracks: true },
        },
      },
    }),
  ]);

  if (!release) {
    throw publicError("Release not found.", {
      status: 404,
    });
  }

  const candidateCapped =
    candidatesRaw.length > take;
  const candidates = candidatesRaw
    .slice(0, take)
    .map(releaseSummary);

  return {
    query: q,
    candidateCapped,
    release: {
      ...releaseSummary(release),
      tracks: release.tracks.map(trackSummary),
    },
    relationships: relationships.map(
      (relationship) => ({
        id: relationship.id,
        relationshipType:
          relationship.relationshipType,
        notes: relationship.notes || "",
        createdAt: relationship.createdAt,
        updatedAt: relationship.updatedAt,
        source: {
          ...releaseSummary(
            relationship.relatedRelease,
          ),
          tracks:
            relationship.relatedRelease.tracks.map(
              trackSummary,
            ),
        },
        trackRelationships:
          relationship.trackRelationships
            .map((mapping) => ({
              id: mapping.id,
              trackId: mapping.trackId,
              relatedTrackId:
                mapping.relatedTrackId,
              recordingRelationship:
                mapping.recordingRelationship,
              notes: mapping.notes || "",
              updatedAt: mapping.updatedAt,
              track: trackSummary(
                mapping.track,
              ),
              relatedTrack: trackSummary(
                mapping.relatedTrack,
              ),
            }))
            .sort(
              (a, b) =>
                Number(a.track.position) -
                Number(b.track.position),
            ),
      }),
    ),
    incoming: incoming.map((relationship) => ({
      id: relationship.id,
      relationshipType:
        relationship.relationshipType,
      release: releaseSummary(
        relationship.release,
      ),
      updatedAt: relationship.updatedAt,
    })),
    candidates,
  };
}
