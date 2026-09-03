import db from "../db.server";
import { publicError } from "./http-security.server";
import {
  buildIsrc,
  isrcAssignmentMode,
  isIsrcConfigured,
  isrcReferenceYear,
  normalizeCountryCode,
  normalizeRegistrantCode,
  validateIsrc,
} from "./isrc";

export async function getIsrcSettings(shop) {
  return db.appSettings.findUnique({ where: { shop } });
}

export async function getSequenceState(shop, settings, year = isrcReferenceYear()) {
  if (!isIsrcConfigured(settings)) {
    return { year, nextDesignation: 1, sequence: null };
  }

  const countryCode = normalizeCountryCode(settings.countryCode);
  const registrantCode = normalizeRegistrantCode(settings.registrantCode);
  const sequence = await db.isrcSequence.findUnique({
    where: {
      shop_countryCode_registrantCode_year: {
        shop,
        countryCode,
        registrantCode,
        year,
      },
    },
  });

  return {
    year,
    nextDesignation: sequence?.nextDesignation || 1,
    sequence,
  };
}

async function reserveNextDesignation(tx, { shop, countryCode, registrantCode, year }) {
  const sequence = await tx.isrcSequence.upsert({
    where: {
      shop_countryCode_registrantCode_year: {
        shop,
        countryCode,
        registrantCode,
        year,
      },
    },
    create: {
      shop,
      countryCode,
      registrantCode,
      year,
      nextDesignation: 1,
    },
    update: {},
  });

  const designation = sequence.nextDesignation;
  if (designation > 99999) {
    throw new Error(`The ${year} ISRC designation sequence is exhausted for ${countryCode}${registrantCode}.`);
  }

  const reserved = await tx.isrcSequence.updateMany({
    where: {
      id: sequence.id,
      nextDesignation: designation,
    },
    data: {
      nextDesignation: { increment: 1 },
    },
  });

  if (reserved.count !== 1) return null;
  return designation;
}

export async function assignIsrcToTrack({ trackId, shop }) {
  const settings = await getIsrcSettings(shop);
  if (isrcAssignmentMode(settings) !== "AUTO") {
    throw new Error(
      "ISRCs are currently provided by the aggregator or Shopify admin in Distribution.",
    );
  }
  if (!isIsrcConfigured(settings)) {
    throw new Error("Configure the ISRC Country Code and Registrant Code in ReleaseCore Settings first.");
  }

  const countryCode = normalizeCountryCode(settings.countryCode);
  const registrantCode = normalizeRegistrantCode(settings.registrantCode);
  const year = isrcReferenceYear();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await db.$transaction(async (tx) => {
      const track = await tx.track.findUnique({
        where: { id: trackId },
        include: { release: true },
      });

      if (!track || track.release.shop !== shop) {
        throw new Error("Track not found for this store.");
      }
      if (track.isrc) return { code: track.isrc, retry: false };

      const designation = await reserveNextDesignation(tx, {
        shop,
        countryCode,
        registrantCode,
        year,
      });
      if (!designation) return { retry: true };

      const code = buildIsrc({ countryCode, registrantCode, year, designation });
      const alreadyUsed = await tx.track.findUnique({ where: { isrc: code } });
      if (alreadyUsed) return { retry: true };

      await tx.track.update({
        where: { id: track.id },
        data: {
          isrc: code,
          isrcAssignedAt: new Date(),
        },
      });
      await tx.submissionEvent.create({
        data: {
          releaseId: track.releaseId,
          type: "ISRC_ASSIGNED",
          message: `Track ${track.position} assigned ${code}`,
        },
      });

      return { code, retry: false };
    });

    if (!result.retry) return result.code;
  }

  throw new Error("ReleaseCore could not reserve a unique ISRC after several attempts. Try again.");
}

export async function maybeAutoAssignIsrc({ trackId, shop }) {
  const settings = await getIsrcSettings(shop);
  if (
    isrcAssignmentMode(settings) !== "AUTO" ||
    !isIsrcConfigured(settings)
  )
    return null;
  return assignIsrcToTrack({ trackId, shop });
}

function validateAdminIsrc(value) {
  try {
    return validateIsrc(value);
  } catch (error) {
    throw publicError(
      error instanceof Error
        ? error.message
        : "Enter a valid 12-character ISRC.",
      { status: 400, code: "INVALID_ISRC" },
    );
  }
}

function duplicateIsrcError(duplicate, shop, code) {
  if (duplicate?.release?.shop === shop) {
    const trackTitle = duplicate.title || "Untitled Track";
    const releaseTitle = duplicate.release?.title || "Untitled Release";
    return publicError(
      `ISRC ${code} is already assigned to "${trackTitle}" on "${releaseTitle}". If this is the same recording, use Add existing song to move that imported Single into the EP/Album instead of assigning the ISRC twice.`,
      { status: 409, code: "ISRC_ALREADY_ASSIGNED" },
    );
  }

  return publicError(
    `ISRC ${code} is already assigned to another recording.`,
    { status: 409, code: "ISRC_ALREADY_ASSIGNED" },
  );
}

export async function assignManualIsrcToTrack({
  trackId,
  shop,
  value,
  actorLabel = "Shopify admin",
}) {
  const code = validateAdminIsrc(value);

  return db.$transaction(async (tx) => {
    const track = await tx.track.findUnique({
      where: { id: trackId },
      include: { release: true },
    });
    if (!track || track.release.shop !== shop) {
      throw new Error("Track not found for this store.");
    }
    if (track.isrc === code) {
      return { code, assigned: false, track };
    }
    if (track.isrc) {
      throw new Error(
        `This recording already has the permanent ISRC ${track.isrc}. Existing ISRCs cannot be replaced.`,
      );
    }

    const duplicate = await tx.track.findUnique({
      where: { isrc: code },
      include: { release: true },
    });
    if (duplicate) {
      throw duplicateIsrcError(duplicate, shop, code);
    }

    const updated = await tx.track.updateMany({
      where: { id: track.id, isrc: null },
      data: { isrc: code, isrcAssignedAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new Error(
        "This track received an ISRC while the request was processing. Refresh before continuing.",
      );
    }

    await tx.submissionEvent.create({
      data: {
        releaseId: track.releaseId,
        trackId: track.id,
        type: "ISRC_ASSIGNED",
        message: `Track ${track.position} assigned ${code} manually by the distributor.`,
        actorLabel,
      },
    });

    return {
      code,
      assigned: true,
      track: { ...track, isrc: code, isrcAssignedAt: new Date() },
    };
  });
}

export async function correctIsrcForTrack({
  trackId,
  shop,
  value,
  actorLabel = "Shopify admin",
}) {
  const code = validateAdminIsrc(value);

  return db.$transaction(async (tx) => {
    const track = await tx.track.findUnique({
      where: { id: trackId },
      include: { release: true },
    });
    if (!track || track.release.shop !== shop) {
      throw new Error("Track not found for this store.");
    }
    if (track.isrc === code) {
      return { code, corrected: false, previousCode: track.isrc, track };
    }

    const duplicate = await tx.track.findUnique({
      where: { isrc: code },
      include: { release: true },
    });
    if (duplicate && duplicate.id !== track.id) {
      throw duplicateIsrcError(duplicate, shop, code);
    }

    const previousCode = track.isrc || null;
    const assignedAt = new Date();
    const updated = await tx.track.update({
      where: { id: track.id },
      data: { isrc: code, isrcAssignedAt: assignedAt },
    });

    await tx.submissionEvent.create({
      data: {
        releaseId: track.releaseId,
        trackId: track.id,
        type: previousCode ? "ISRC_CORRECTED" : "ISRC_ASSIGNED",
        message: previousCode
          ? `Track ${track.position} ISRC corrected from ${previousCode} to ${code} by the distributor.`
          : `Track ${track.position} assigned ${code} manually by the distributor.`,
        actorLabel,
      },
    });

    return {
      code,
      corrected: Boolean(previousCode),
      previousCode,
      track: updated,
    };
  });
}

export async function assignMissingIsrcsForRelease({ releaseId, shop }) {
  const release = await db.release.findFirst({
    where: { id: releaseId, shop },
    include: { tracks: { orderBy: { position: "asc" } } },
  });
  if (!release) throw new Error("Release not found for this store.");

  let assigned = 0;
  for (const track of release.tracks) {
    if (track.isrc) continue;
    await assignIsrcToTrack({ trackId: track.id, shop });
    assigned += 1;
  }
  return assigned;
}

export async function assignMissingIsrcsForShop({ shop }) {
  const tracks = await db.track.findMany({
    where: {
      isrc: null,
      release: { shop },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  let assigned = 0;
  for (const track of tracks) {
    await assignIsrcToTrack({ trackId: track.id, shop });
    assigned += 1;
  }
  return assigned;
}
