import db from "../db.server";
import { isrcAssignmentMode } from "./isrc";
import { findShopRelease } from "./tenant-db.server";

const RELEASE_WORKSPACE_INCLUDE = {
  artists: { include: { artist: true }, orderBy: { position: "asc" } },
  files: { where: { trackId: null }, orderBy: { createdAt: "desc" } },
  tracks: {
    orderBy: { position: "asc" },
    include: {
      artists: { include: { artist: true }, orderBy: { position: "asc" } },
      credits: {
        include: { contributor: true },
        orderBy: { createdAt: "asc" },
      },
      files: { orderBy: { createdAt: "desc" } },
    },
  },
  events: { orderBy: { createdAt: "desc" }, take: 20 },
  reviewItems: { include: { track: true }, orderBy: { createdAt: "desc" } },
};

export async function loadReleaseWorkspace({ shop, releaseId }) {
  const [release, artists, contributors, settings, existingSongReleases] = await Promise.all([
    findShopRelease(shop, releaseId, { include: RELEASE_WORKSPACE_INCLUDE }),
    db.artist.findMany({
      where: { shop },
      orderBy: { name: "asc" },
      include: { contributors: true },
    }),
    db.contributor.findMany({
      where: { shop },
      orderBy: { legalName: "asc" },
      include: { artists: { include: { artist: true } } },
    }),
    db.appSettings.findUnique({ where: { shop } }),
    db.release.findMany({
      where: {
        shop,
        id: { not: releaseId },
        type: "SINGLE",
        tracks: {
          some: { shopifyProductId: { not: null } },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 250,
      include: {
        artists: {
          include: { artist: true },
          orderBy: { position: "asc" },
        },
        tracks: {
          where: { shopifyProductId: { not: null } },
          orderBy: { position: "asc" },
          take: 1,
          include: {
            artists: {
              include: { artist: true },
              orderBy: { position: "asc" },
            },
          },
        },
        _count: { select: { tracks: true } },
      },
    }),
  ]);

  if (!release) return null;

  const configured = Boolean(
    settings?.countryCode &&
      /^[A-Z]{2}$/.test(settings.countryCode) &&
      settings?.registrantCode &&
      /^[A-Z0-9]{3}$/.test(settings.registrantCode),
  );

  return {
    release,
    artists,
    contributors,
    isrcSettings: {
      configured,
      mode: isrcAssignmentMode(settings),
    },
    workflowSettings: settings || {},
    existingSongs: existingSongReleases
      .filter(
        (item) =>
          item._count.tracks === 1 &&
          item.tracks.length === 1 &&
          item.tracks[0].shopifyProductId,
      )
      .map((item) => {
        const track = item.tracks[0];
        const primaryTrackArtist = (track.artists || []).find(
          (assignment) => assignment.role === "PRIMARY",
        );
        const primaryReleaseArtist = (item.artists || []).find(
          (assignment) => assignment.role === "PRIMARY",
        );
        return {
          releaseId: item.id,
          releaseTitle: item.title,
          releaseStatus: item.status,
          trackId: track.id,
          title: track.title,
          isrc: track.isrc,
          shopifyProductId: track.shopifyProductId,
          shopifyProductHandle: track.shopifyProductHandle,
          artistName:
            primaryTrackArtist?.artist?.name ||
            primaryReleaseArtist?.artist?.name ||
            item.artistName ||
            null,
        };
      }),
  };
}
