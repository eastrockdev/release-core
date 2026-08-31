import db from "../db.server";
import {
  buildIsrc,
  isIsrcConfigured,
  isrcReferenceYear,
  normalizeCountryCode,
  normalizeRegistrantCode,
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
  if (!settings?.autoAssignIsrc || !isIsrcConfigured(settings)) return null;
  return assignIsrcToTrack({ trackId, shop });
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
