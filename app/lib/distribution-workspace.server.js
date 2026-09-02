import db from "../db.server";
import { findShopRelease } from "./tenant-db.server";

const DISTRIBUTION_RELEASE_INCLUDE = {
  artists: { include: { artist: true }, orderBy: { position: "asc" } },
  files: { orderBy: { createdAt: "desc" } },
  tracks: {
    orderBy: { position: "asc" },
    include: {
      artists: { include: { artist: true }, orderBy: { position: "asc" } },
      credits: {
        include: {
          contributor: {
            include: { artists: { include: { artist: true } } },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      files: true,
    },
  },
  events: { orderBy: { createdAt: "desc" }, take: 30 },
};

export async function loadDistributionWorkspace({ shop, releaseId }) {
  const [release, settings] = await Promise.all([
    findShopRelease(shop, releaseId, { include: DISTRIBUTION_RELEASE_INCLUDE }),
    db.appSettings.findUnique({ where: { shop } }),
  ]);
  if (!release) return null;
  return { release, settings };
}
