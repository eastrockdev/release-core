import db from "../db.server";
import { maybeAutoAssignIsrc } from "./isrc.server";
import {
  isValidReleaseType,
  starterTitle,
  typeLabel,
} from "./releasecore";
import { publicError } from "./http-security.server";

export const RELEASE_TEMPLATE_BLUEPRINT_VERSION = 1;

export const RELEASE_TEMPLATE_RESET_POLICY = Object.freeze([
  "releaseDate",
  "preOrderDate",
  "preSaveUrl",
  "streamingUrl",
  "upc",
  "catalogNumber",
  "isrc",
  "masterFiles",
  "supportingFiles",
  "shopifyProductIds",
  "shopifyHandles",
  "submissionHistory",
  "reviewItems",
  "distributionState",
  "ownerCustomerId",
]);

const SOURCE_INCLUDE = {
  artists: {
    orderBy: { position: "asc" },
    select: {
      artistId: true,
      role: true,
      position: true,
    },
  },
  tracks: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      position: true,
      title: true,
      version: true,
      language: true,
      explicit: true,
      artists: {
        orderBy: { position: "asc" },
        select: {
          artistId: true,
          role: true,
          position: true,
        },
      },
      credits: {
        orderBy: { createdAt: "asc" },
        select: {
          contributorId: true,
          role: true,
          ownershipPercent: true,
        },
      },
    },
  },
};

function cleanText(value, max = 200) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : "";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertBlueprint(blueprint) {
  if (
    !blueprint ||
    blueprint.version !== RELEASE_TEMPLATE_BLUEPRINT_VERSION ||
    !blueprint.release ||
    !isValidReleaseType(blueprint.release.type) ||
    !Array.isArray(blueprint.tracks)
  ) {
    throw publicError(
      "This release template is not compatible with the current ReleaseCore template format.",
      { status: 409 },
    );
  }
  return blueprint;
}

export function releaseBlueprintFromRecord(release) {
  if (!release || !isValidReleaseType(release.type)) {
    throw publicError(
      "ReleaseCore could not build a reusable blueprint from this release.",
      { status: 400 },
    );
  }

  return {
    version: RELEASE_TEMPLATE_BLUEPRINT_VERSION,
    source: {
      releaseId: release.id,
      title: release.title,
    },
    release: {
      type: release.type,
      primaryGenre: release.primaryGenre || null,
      availability:
        release.availability || "ALL_CURRENT_FUTURE",
      preOrderEnabled: Boolean(release.preOrderEnabled),
      preOrderAudioPreviews: Boolean(
        release.preOrderAudioPreviews,
      ),
      releaseTimeEnabled: Boolean(
        release.releaseTimeEnabled,
      ),
      releaseTime: release.releaseTime || null,
      synchronousReleaseUnlocking: Boolean(
        release.synchronousReleaseUnlocking,
      ),
      exclusiveEnabled: Boolean(
        release.exclusiveEnabled,
      ),
      exclusivePartner:
        release.exclusivePartner || null,
      exclusivePeriodWeeks:
        release.exclusivePeriodWeeks || null,
      artists: (release.artists || []).map(
        (assignment) => ({
          artistId: assignment.artistId,
          role: assignment.role,
          position: assignment.position,
        }),
      ),
    },
    tracks: (release.tracks || []).map(
      (track, index) => ({
        position:
          Number(track.position) || index + 1,
        title: track.title || "Untitled Track",
        version: track.version || null,
        language: track.language || null,
        explicit: Boolean(track.explicit),
        artists: (track.artists || []).map(
          (assignment) => ({
            artistId: assignment.artistId,
            role: assignment.role,
            position: assignment.position,
          }),
        ),
        credits: (track.credits || []).map(
          (credit) => ({
            contributorId: credit.contributorId,
            role: credit.role,
            ownershipPercent:
              credit.ownershipPercent ?? null,
          }),
        ),
      }),
    ),
  };
}

async function sourceRelease({
  shop,
  releaseId,
}) {
  const release = await db.release.findFirst({
    where: {
      id: releaseId,
      shop,
    },
    include: SOURCE_INCLUDE,
  });

  if (!release) {
    throw publicError("Release not found.", {
      status: 404,
    });
  }

  return release;
}

export async function releaseReusePreview({
  shop,
  releaseId,
}) {
  const release = await sourceRelease({
    shop,
    releaseId,
  });

  return {
    id: release.id,
    title: release.title,
    type: release.type,
    primaryGenre: release.primaryGenre,
    trackCount: release.tracks.length,
    artistCount: release.artists.length,
    creditCount: release.tracks.reduce(
      (sum, track) =>
        sum + track.credits.length,
      0,
    ),
  };
}

export async function listReleaseTemplates({
  shop,
}) {
  return db.releaseTemplate.findMany({
    where: { shop },
    orderBy: [
      { updatedAt: "desc" },
      { name: "asc" },
    ],
    select: {
      id: true,
      name: true,
      description: true,
      sourceReleaseId: true,
      releaseType: true,
      trackCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getReleaseTemplate({
  shop,
  templateId,
}) {
  const template =
    await db.releaseTemplate.findFirst({
      where: {
        id: templateId,
        shop,
      },
    });

  if (!template) {
    throw publicError(
      "Release template not found.",
      { status: 404 },
    );
  }

  const blueprint = assertBlueprint(
    cloneJson(template.blueprint),
  );

  return {
    ...template,
    blueprint,
  };
}

export async function createReleaseTemplate({
  shop,
  sourceReleaseId,
  name,
  description = "",
}) {
  const cleanName = cleanText(name, 80);
  const cleanDescription = cleanText(
    description,
    240,
  );

  if (!cleanName) {
    throw publicError(
      "Enter a name for this release template.",
      { status: 400 },
    );
  }

  const existing =
    await db.releaseTemplate.findFirst({
      where: {
        shop,
        name: {
          equals: cleanName,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

  if (existing) {
    throw publicError(
      "A release template with that name already exists.",
      { status: 409 },
    );
  }

  const release = await sourceRelease({
    shop,
    releaseId: sourceReleaseId,
  });
  const blueprint =
    releaseBlueprintFromRecord(release);

  const template =
    await db.releaseTemplate.create({
      data: {
        shop,
        name: cleanName,
        description:
          cleanDescription || null,
        sourceReleaseId: release.id,
        releaseType: release.type,
        trackCount: Math.max(
          1,
          release.tracks.length,
        ),
        blueprint,
      },
    });

  return {
    id: template.id,
    name: template.name,
    releaseType: template.releaseType,
    trackCount: template.trackCount,
  };
}

export async function deleteReleaseTemplate({
  shop,
  templateId,
}) {
  const template =
    await db.releaseTemplate.findFirst({
      where: {
        id: templateId,
        shop,
      },
      select: {
        id: true,
        name: true,
      },
    });

  if (!template) {
    throw publicError(
      "Release template not found.",
      { status: 404 },
    );
  }

  await db.releaseTemplate.delete({
    where: { id: template.id },
  });

  return template;
}

function releaseArtistsCreate(artists = []) {
  return artists
    .filter(
      (item) =>
        item?.artistId &&
        item?.role,
    )
    .map((item, index) => ({
      artistId: item.artistId,
      role: item.role,
      position:
        Number(item.position) || index + 1,
    }));
}

function trackArtistsCreate(artists = []) {
  return artists
    .filter(
      (item) =>
        item?.artistId &&
        item?.role,
    )
    .map((item, index) => ({
      artistId: item.artistId,
      role: item.role,
      position:
        Number(item.position) || index + 1,
    }));
}

function trackCreditsCreate(credits = []) {
  return credits
    .filter(
      (item) =>
        item?.contributorId &&
        item?.role,
    )
    .map((item) => ({
      contributorId: item.contributorId,
      role: item.role,
      ownershipPercent:
        item.ownershipPercent ?? null,
    }));
}

async function assignFreshIsrcs({
  shop,
  tracks,
}) {
  for (const track of tracks || []) {
    try {
      await maybeAutoAssignIsrc({
        trackId: track.id,
        shop,
      });
    } catch (error) {
      console.error(
        "ReleaseCore: automatic ISRC assignment skipped during reusable-draft creation",
        error,
      );
    }
  }
}

export async function createDraftFromBlueprint({
  shop,
  blueprint,
  requestedTitle = "",
  titleFallback = "",
  eventMessage = "",
}) {
  const safe = assertBlueprint(
    cloneJson(blueprint),
  );
  const type = safe.release.type;

  const title =
    cleanText(requestedTitle, 220) ||
    cleanText(titleFallback, 220) ||
    starterTitle(type);

  const trackBlueprints =
    safe.tracks.length
      ? safe.tracks
      : [
          {
            position: 1,
            title:
              type === "SINGLE"
                ? title
                : "Untitled Track",
            language: null,
            version: null,
            explicit: false,
            artists: [],
            credits: [],
          },
        ];

  if (
    type === "SINGLE" &&
    trackBlueprints.length !== 1
  ) {
    throw publicError(
      "A Single template must contain exactly one track.",
      { status: 409 },
    );
  }

  const release = await db.release.create({
    data: {
      shop,
      type,
      title,
      status: "DRAFT",
      distributionStatus: "NOT_QUEUED",
      distributionUpdatedAt: null,
      primaryGenre:
        safe.release.primaryGenre || null,
      releaseDate: null,
      availability:
        safe.release.availability ||
        "ALL_CURRENT_FUTURE",
      preOrderEnabled: Boolean(
        safe.release.preOrderEnabled,
      ),
      preOrderDate: null,
      preOrderAudioPreviews: Boolean(
        safe.release.preOrderAudioPreviews,
      ),
      releaseTimeEnabled: Boolean(
        safe.release.releaseTimeEnabled,
      ),
      releaseTime:
        safe.release.releaseTime || null,
      synchronousReleaseUnlocking: Boolean(
        safe.release.synchronousReleaseUnlocking,
      ),
      exclusiveEnabled: Boolean(
        safe.release.exclusiveEnabled,
      ),
      exclusivePartner:
        safe.release.exclusivePartner || null,
      exclusivePeriodWeeks:
        safe.release.exclusivePeriodWeeks ||
        null,
      preSaveUrl: null,
      streamingUrl: null,
      submittedAt: null,
      lastSubmittedAt: null,
      reviewStartedAt: null,
      decisionAt: null,
      ownerCustomerId: null,
      aggregatorReference: null,
      distributionNotes: null,
      upc: null,
      upcAssignedAt: null,
      catalogNumber: null,
      catalogNumberAssignedAt: null,
      shopifyReleaseProductId: null,
      shopifyReleaseProductHandle: null,
      shopifyReleaseBundleOperationId: null,
      artists: {
        create: releaseArtistsCreate(
          safe.release.artists,
        ),
      },
      tracks: {
        create: trackBlueprints.map(
          (track, index) => ({
            position:
              Number(track.position) ||
              index + 1,
            title:
              track.title ||
              "Untitled Track",
            version:
              track.version || null,
            language:
              track.language || null,
            explicit: Boolean(
              track.explicit,
            ),
            artists: {
              create: trackArtistsCreate(
                track.artists,
              ),
            },
            credits: {
              create: trackCreditsCreate(
                track.credits,
              ),
            },
          }),
        ),
      },
      events: {
        create: {
          type: "DRAFT_CREATED",
          message:
            eventMessage ||
            `${typeLabel(type)} draft created from reusable release metadata`,
          actorLabel: "Shopify admin",
        },
      },
    },
    include: {
      tracks: {
        orderBy: {
          position: "asc",
        },
      },
    },
  });

  await assignFreshIsrcs({
    shop,
    tracks: release.tracks,
  });

  return release;
}

export async function createBlankReleaseDraft({
  shop,
  type,
  requestedTitle = "",
}) {
  if (!isValidReleaseType(type)) {
    throw publicError(
      "Choose Single, EP or Album before creating the release.",
      { status: 400 },
    );
  }

  const settings =
    await db.appSettings.findUnique({
      where: { shop },
    });
  const title =
    cleanText(requestedTitle, 220) ||
    starterTitle(type);
  const firstTrackTitle =
    type === "SINGLE" &&
    cleanText(requestedTitle, 220)
      ? cleanText(requestedTitle, 220)
      : "Untitled Track";

  const release = await db.release.create({
    data: {
      shop,
      type,
      title,
      status: "DRAFT",
      primaryGenre:
        settings?.defaultGenre || null,
      tracks: {
        create: {
          position: 1,
          title: firstTrackTitle,
          language:
            settings?.defaultLanguage ||
            null,
        },
      },
      events: {
        create: {
          type: "DRAFT_CREATED",
          message: `${typeLabel(type)} draft created`,
          actorLabel: "Shopify admin",
        },
      },
    },
    include: { tracks: true },
  });

  await assignFreshIsrcs({
    shop,
    tracks: release.tracks,
  });

  return release;
}

export async function createDraftFromTemplate({
  shop,
  templateId,
  requestedTitle = "",
}) {
  const template =
    await getReleaseTemplate({
      shop,
      templateId,
    });

  return createDraftFromBlueprint({
    shop,
    blueprint: template.blueprint,
    requestedTitle,
    titleFallback: starterTitle(
      template.releaseType,
    ),
    eventMessage: `${typeLabel(
      template.releaseType,
    )} draft created from template “${template.name}”`,
  });
}

export async function duplicateReleaseDraft({
  shop,
  sourceReleaseId,
  requestedTitle = "",
}) {
  const release = await sourceRelease({
    shop,
    releaseId: sourceReleaseId,
  });
  const blueprint =
    releaseBlueprintFromRecord(release);

  return createDraftFromBlueprint({
    shop,
    blueprint,
    requestedTitle,
    titleFallback: `${release.title} Copy`,
    eventMessage: `${typeLabel(
      release.type,
    )} draft duplicated from “${release.title}”`,
  });
}
