import { getReleaseProductState, getTrackProductState } from "./shopify-catalog.server";
import db from "../db.server";
import { findShopRelease } from "./tenant-db.server";
import {
  buildDistributionHealth,
  runDistributionPreflight,
} from "./distribution-health.server";
import { buildPublicationOrchestration } from "./publication-orchestration.server";
import { listReleaseOperationJobs } from "./operation-jobs.server";
import { decorateRestartableOperationJobs } from "./operation-job-recovery.server";

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

export async function loadDistributionWorkspace({ admin, shop, releaseId }) {
  const [release, settings] = await Promise.all([
    findShopRelease(shop, releaseId, { include: DISTRIBUTION_RELEASE_INCLUDE }),
    db.appSettings.findUnique({ where: { shop } }),
  ]);
  if (!release) return null;
  const operationJobs = decorateRestartableOperationJobs(
    await listReleaseOperationJobs({
      shop,
      releaseId,
      take: 10,
    }),
  );
  const [tracks, shopifyReleaseState] = await Promise.all([
    Promise.all(release.tracks.map(async (track) => ({
      ...track,
      shopifyState: track.shopifyProductId ? await getTrackProductState(admin, track.shopifyProductId) : null,
    }))),
    release.shopifyReleaseProductId ? getReleaseProductState(admin, release.shopifyReleaseProductId) : null,
  ]);
  const hydratedRelease = {
    ...release,
    tracks,
    shopifyReleaseState,
  };
  const preflight = await runDistributionPreflight({
    admin,
    release: hydratedRelease,
    settings,
  });
  const syncHealth = buildDistributionHealth({
    release: hydratedRelease,
    settings,
    preflight,
  });
  const publicationOrchestration =
    await buildPublicationOrchestration({
      admin,
      release: hydratedRelease,
    });
  return {
    release: hydratedRelease,
    settings,
    syncHealth,
    operationJobs,
    publicationOrchestration,
  };
}