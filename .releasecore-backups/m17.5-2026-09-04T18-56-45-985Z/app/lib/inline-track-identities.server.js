import db from "../db.server";
import {
  ARTIST_ROLES,
  CREDIT_ROLES,
  isPublishingRole,
} from "./releasecore";
import { publicError } from "./http-security.server";
import { releaseIsEditable } from "./workflow";

function identityName(value, label) {
  const clean = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 200);

  if (!clean) {
    throw publicError(`${label} is required.`, {
      status: 400,
    });
  }

  return clean;
}

function parseOwnership(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const number = Number(raw);
  if (
    !Number.isFinite(number) ||
    number < 0 ||
    number > 100
  ) {
    throw publicError(
      "Ownership must be between 0 and 100%.",
      { status: 400 },
    );
  }

  return Math.round(number * 100) / 100;
}

async function editableTrack(
  tx,
  { shop, releaseId, trackId },
) {
  const track = await tx.track.findFirst({
    where: {
      id: trackId,
      releaseId,
      release: { shop },
    },
    include: {
      release: {
        select: {
          id: true,
          title: true,
          status: true,
        },
      },
    },
  });

  if (!track) {
    throw publicError("Track not found.", {
      status: 404,
    });
  }

  if (!releaseIsEditable(track.release.status)) {
    throw publicError(
      "Reopen this release before adding a new artist or contributor.",
      { status: 409 },
    );
  }

  return track;
}

export async function createAndAssignTrackArtist({
  shop,
  releaseId,
  trackId,
  name,
  role = "PRIMARY",
  actorLabel = "Shopify admin",
}) {
  const artistName = identityName(
    name,
    "Artist name",
  );
  const artistRole = String(
    role || "PRIMARY",
  ).toUpperCase();

  if (!ARTIST_ROLES.includes(artistRole)) {
    throw publicError(
      "Choose a valid artist role.",
      { status: 400 },
    );
  }

  return db.$transaction(async (tx) => {
    const track = await editableTrack(tx, {
      shop,
      releaseId,
      trackId,
    });

    const existing = await tx.artist.findFirst({
      where: {
        shop,
        name: {
          equals: artistName,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (existing) {
      throw publicError(
        `Artist “${existing.name}” already exists. Switch to Existing artist and choose that record instead.`,
        {
          status: 409,
          code: "ARTIST_ALREADY_EXISTS",
        },
      );
    }

    const artist = await tx.artist.create({
      data: {
        shop,
        name: artistName,
      },
    });

    const position =
      (await tx.trackArtist.count({
        where: { trackId: track.id },
      })) + 1;

    await tx.trackArtist.create({
      data: {
        trackId: track.id,
        artistId: artist.id,
        role: artistRole,
        position,
      },
    });

    await tx.submissionEvent.create({
      data: {
        releaseId,
        trackId: track.id,
        type: "TRACK_ARTIST_CREATED_INLINE",
        message: `${artist.name} was created in the artist directory and added to Track ${track.position}.`,
        actorLabel,
      },
    });

    return {
      artistId: artist.id,
      artistName: artist.name,
      role: artistRole,
    };
  });
}

export async function createAndCreditTrackContributor({
  shop,
  releaseId,
  trackId,
  legalName,
  role,
  ownership = null,
  actorLabel = "Shopify admin",
}) {
  const contributorName = identityName(
    legalName,
    "Contributor name",
  );
  const creditRole = String(
    role || "",
  ).toUpperCase();

  if (!CREDIT_ROLES.includes(creditRole)) {
    throw publicError(
      "Choose a valid credit role.",
      { status: 400 },
    );
  }

  return db.$transaction(async (tx) => {
    const track = await editableTrack(tx, {
      shop,
      releaseId,
      trackId,
    });

    const existing =
      await tx.contributor.findFirst({
        where: {
          shop,
          OR: [
            {
              legalName: {
                equals: contributorName,
                mode: "insensitive",
              },
            },
            {
              stageName: {
                equals: contributorName,
                mode: "insensitive",
              },
            },
          ],
        },
        select: {
          id: true,
          legalName: true,
          stageName: true,
        },
      });

    if (existing) {
      throw publicError(
        `Contributor “${existing.stageName || existing.legalName}” already exists. Switch to Existing contributor and choose that record instead.`,
        {
          status: 409,
          code: "CONTRIBUTOR_ALREADY_EXISTS",
        },
      );
    }

    const settings =
      await tx.appSettings.findUnique({
        where: { shop },
        select: {
          requirePublishing: true,
        },
      });

    const creditSplitsEnabled =
      settings?.requirePublishing ?? true;

    let split = creditSplitsEnabled
      ? parseOwnership(ownership)
      : null;

    if (
      !creditSplitsEnabled ||
      !isPublishingRole(creditRole)
    ) {
      split = null;
    }

    if (
      creditSplitsEnabled &&
      isPublishingRole(creditRole)
    ) {
      const credits =
        await tx.trackCredit.findMany({
          where: { trackId: track.id },
          select: {
            role: true,
            ownershipPercent: true,
          },
        });

      const assigned = credits
        .filter((credit) =>
          isPublishingRole(credit.role),
        )
        .reduce(
          (sum, credit) =>
            sum +
            Number(
              credit.ownershipPercent || 0,
            ),
          0,
        );

      if (
        assigned + Number(split || 0) >
        100.00001
      ) {
        throw publicError(
          `Publishing ownership cannot exceed 100%. Current assigned total is ${assigned}%.`,
          { status: 400 },
        );
      }
    }

    const contributor =
      await tx.contributor.create({
        data: {
          shop,
          legalName: contributorName,
        },
      });

    await tx.trackCredit.create({
      data: {
        trackId: track.id,
        contributorId: contributor.id,
        role: creditRole,
        ownershipPercent: split,
      },
    });

    await tx.submissionEvent.create({
      data: {
        releaseId,
        trackId: track.id,
        type: "TRACK_CONTRIBUTOR_CREATED_INLINE",
        message: `${contributor.legalName} was created in the contributor directory and credited on Track ${track.position}.`,
        actorLabel,
      },
    });

    return {
      contributorId: contributor.id,
      contributorName:
        contributor.legalName,
      role: creditRole,
      ownershipPercent: split,
    };
  });
}
