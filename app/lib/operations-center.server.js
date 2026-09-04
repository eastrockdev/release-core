import db from "../db.server";
import { calculateReleaseReadiness } from "./workflow";
import {
  countOpenSystemIssues,
  listRecentSystemIssues,
} from "./system-issues.server";

const ACTIVE_RELEASE_STATUSES = [
  "SUBMITTED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
];

const ACTIVE_DISTRIBUTION_STATUSES = [
  "QUEUED",
  "PROCESSING",
  "SUBMITTED_TO_STORES",
  "RETURNED_FOR_CORRECTIONS",
];

const SYNC_EVENT_TYPES = [
  "SHOPIFY_SYNC_FAILED",
  "SHOPIFY_SYNC_WARNING",
  "SHOPIFY_PUBLICATION_WARNING",
  "SHOPIFY_PRODUCTS_SYNCED",
  "SHOPIFY_RELEASE_PRODUCT_SYNCED",
  "SHOPIFY_SYNC_RETRY_SUCCEEDED",
];

const SYNC_SUCCESS_TYPES = new Set([
  "SHOPIFY_PRODUCTS_SYNCED",
  "SHOPIFY_RELEASE_PRODUCT_SYNCED",
  "SHOPIFY_SYNC_RETRY_SUCCEEDED",
]);

function releaseSummary(release) {
  return {
    id: release.id,
    title: release.title,
    type: release.type,
    artistName: release.artistName,
    status: release.status,
    distributionStatus: release.distributionStatus,
    releaseDate: release.releaseDate,
    catalogNumber: release.catalogNumber,
    upc: release.upc,
    trackCount: release.tracks?.length || 0,
    files: (release.files || [])
      .filter((file) => file.kind === "COVER_ART")
      .map((file) => ({
        kind: file.kind,
        url: file.url,
      })),
  };
}

function issueHref(releaseId, blocker) {
  if (blocker?.trackId) {
    return `/app/release/${releaseId}/track/${blocker.trackId}`;
  }
  return `/app/release/${releaseId}`;
}

function latestSyncSignal(release) {
  return (
    (release.events || []).find((event) =>
      SYNC_EVENT_TYPES.includes(event.type),
    ) || null
  );
}

function primaryPortalConnected(release) {
  if (release.ownerCustomerId) return true;
  return (release.artists || []).some(
    (assignment) =>
      assignment.role === "PRIMARY" &&
      (assignment.artist?.portalAccess || []).length > 0,
  );
}

function dedupeBlockers(blockers) {
  const seen = new Set();
  return blockers.filter((item) => {
    const key = `${item.code}:${item.trackId || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function distributionReadiness(release, settings) {
  const base = calculateReleaseReadiness(release, settings);
  const blockers = [...base.blockers];

  if (!release.catalogNumber) {
    blockers.push({
      code: "CATALOG_NUMBER",
      message: "Assign a catalog number before distribution.",
    });
  }

  if (settings?.requireIsrc !== false) {
    for (const track of release.tracks || []) {
      if (!track.isrc) {
        blockers.push({
          code: "ISRC",
          trackId: track.id,
          message: `Track ${track.position} needs an ISRC before distribution.`,
        });
      }
    }
  }

  const uniqueBlockers = dedupeBlockers(blockers);

  return {
    ...base,
    blockers: uniqueBlockers,
    ready: uniqueBlockers.length === 0,
  };
}

function daysUntil(date, now) {
  if (!date) return null;
  return Math.ceil(
    (new Date(date).getTime() - now.getTime()) /
      (24 * 60 * 60 * 1000),
  );
}

function operationalIssuesForRelease(release, settings, now) {
  const issues = [];
  const summary = releaseSummary(release);
  const readiness = distributionReadiness(release, settings);
  const syncSignal = latestSyncSignal(release);
  const openReviewItems = release.reviewItems || [];
  const failedNotifications = release.notifications || [];
  const releaseDays = daysUntil(release.releaseDate, now);

  if (release.status === "CHANGES_REQUESTED") {
    issues.push({
      key: `${release.id}:changes-requested`,
      severity: "warning",
      requiresAction: true,
      category: "Review",
      title: "Changes requested",
      message: openReviewItems.length
        ? `${openReviewItems.length} requested change${openReviewItems.length === 1 ? "" : "s"} still need attention.`
        : "The release was returned for changes and needs another pass.",
      href: `/app/release/${release.id}`,
      actionLabel: "Open release",
      release: summary,
    });
  }

  if (release.distributionStatus === "RETURNED_FOR_CORRECTIONS") {
    issues.push({
      key: `${release.id}:distribution-returned`,
      severity: "critical",
      requiresAction: true,
      category: "Distribution",
      title: "Returned for corrections",
      message:
        "Distribution returned this release. Review the delivery notes and correct the affected metadata.",
      href: `/app/distribution/${release.id}`,
      actionLabel: "Open distribution",
      release: summary,
    });
  }

  if (syncSignal?.type === "SHOPIFY_SYNC_FAILED") {
    issues.push({
      key: `${release.id}:shopify-sync`,
      severity: "critical",
      requiresAction: true,
      category: "Shopify sync",
      title: "Shopify sync needs recovery",
      message:
        "The latest Shopify synchronization attempt failed. Open Sync Health to inspect the affected item and retry it.",
      href: `/app/distribution/${release.id}#sync-health`,
      actionLabel: "Open Sync Health",
      release: summary,
    });
  } else if (
    syncSignal &&
    !SYNC_SUCCESS_TYPES.has(syncSignal.type) &&
    [
      "SHOPIFY_SYNC_WARNING",
      "SHOPIFY_PUBLICATION_WARNING",
    ].includes(syncSignal.type)
  ) {
    issues.push({
      key: `${release.id}:shopify-warning`,
      severity: "warning",
      requiresAction: true,
      category: "Shopify sync",
      title: "Shopify sync warning",
      message:
        "The latest Shopify operation completed with a warning. Check Sync Health before the next publication or delivery step.",
      href: `/app/distribution/${release.id}#sync-health`,
      actionLabel: "Open Sync Health",
      release: summary,
    });
  }

  if (failedNotifications.length) {
    issues.push({
      key: `${release.id}:notification`,
      severity: "warning",
      requiresAction: true,
      category: "Notification",
      title: "Notification delivery failed",
      message: `${failedNotifications.length} recent notification deliver${failedNotifications.length === 1 ? "y" : "ies"} need review.`,
      href: "/app/notifications",
      actionLabel: "Open notifications",
      release: summary,
    });
  }

  if (
    release.status === "APPROVED" &&
    release.distributionStatus === "NOT_QUEUED" &&
    !readiness.ready
  ) {
    const first = readiness.blockers[0];
    issues.push({
      key: `${release.id}:approved-readiness`,
      severity: "critical",
      requiresAction: true,
      category: "Preflight",
      title: "Approved but not distribution-ready",
      message: `${readiness.blockers.length} readiness item${readiness.blockers.length === 1 ? "" : "s"} remain. ${first?.message || ""}`.trim(),
      href: issueHref(release.id, first),
      actionLabel: first?.trackId
        ? "Edit track info"
        : "Open release",
      release: summary,
    });
  }

  if (
    releaseDays !== null &&
    releaseDays >= 0 &&
    releaseDays <= 7 &&
    release.distributionStatus !== "DELIVERED" &&
    !readiness.ready
  ) {
    const first = readiness.blockers[0];
    issues.push({
      key: `${release.id}:upcoming-readiness`,
      severity: releaseDays <= 3 ? "critical" : "warning",
      requiresAction: true,
      category: "Schedule",
      title:
        releaseDays === 0
          ? "Release date is today"
          : `Release date is in ${releaseDays} day${releaseDays === 1 ? "" : "s"}`,
      message: `${readiness.blockers.length} readiness item${readiness.blockers.length === 1 ? "" : "s"} still remain before this release is operationally complete.`,
      href: issueHref(release.id, first),
      actionLabel: first?.trackId
        ? "Fix first track issue"
        : "Open release",
      release: summary,
    });
  }

  if (
    ["SUBMITTED", "IN_REVIEW", "APPROVED"].includes(
      release.status,
    ) &&
    !primaryPortalConnected(release)
  ) {
    issues.push({
      key: `${release.id}:portal-access`,
      severity: "info",
      requiresAction: false,
      category: "Artist access",
      title: "No Artist Portal customer linked",
      message:
        "No owner customer or primary-artist Portal Access assignment is connected to this release. This is optional, but worth confirming for artist-facing workflows.",
      href: "/app/portal-access",
      actionLabel: "Review Portal Access",
      release: summary,
    });
  }

  return {
    issues,
    readiness,
    releaseDays,
  };
}

function issuePriority(issue) {
  if (issue.severity === "critical") return 0;
  if (issue.severity === "warning") return 1;
  return 2;
}

export async function loadOperationsCenter({
  shop,
  releaseLimit = 200,
  issueLimit = 40,
} = {}) {
  if (!shop) {
    throw new Error("loadOperationsCenter requires a shop.");
  }

  const now = new Date();
  const sevenDays = new Date(
    now.getTime() + 7 * 24 * 60 * 60 * 1000,
  );

  const [
    settings,
    releases,
    waitingReview,
    scheduledNextSevenDays,
    activeBackgroundJobs,
    failedBackgroundJobs,
    openSystemIssues,
    recentSystemIssues,
  ] = await Promise.all([
    db.appSettings.findUnique({ where: { shop } }),
    db.release.findMany({
      where: {
        shop,
        status: { not: "REJECTED" },
        OR: [
          { status: { in: ACTIVE_RELEASE_STATUSES } },
          {
            distributionStatus: {
              in: ACTIVE_DISTRIBUTION_STATUSES,
            },
          },
          {
            releaseDate: {
              gte: now,
              lte: sevenDays,
            },
          },
        ],
      },
      orderBy: [
        { releaseDate: "asc" },
        { updatedAt: "desc" },
      ],
      take: releaseLimit,
      include: {
        artists: {
          select: {
            role: true,
            artist: {
              select: {
                name: true,
                portalAccess: {
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        },
        files: {
          where: { trackId: null },
          select: {
            kind: true,
            url: true,
          },
        },
        tracks: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            position: true,
            title: true,
            language: true,
            isrc: true,
            lyrics: true,
            artists: {
              select: { role: true },
            },
            credits: {
              select: {
                role: true,
                ownershipPercent: true,
              },
            },
            files: {
              select: {
                kind: true,
                storageKey: true,
                url: true,
              },
            },
          },
        },
        events: {
          where: {
            type: { in: SYNC_EVENT_TYPES },
          },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            type: true,
            createdAt: true,
          },
        },
        reviewItems: {
          where: { status: "OPEN" },
          select: {
            id: true,
            trackId: true,
            message: true,
            status: true,
          },
        },
        notifications: {
          where: { status: "FAILED" },
          orderBy: { updatedAt: "desc" },
          take: 5,
          select: {
            id: true,
            channel: true,
            lastError: true,
          },
        },
      },
    }),
    db.release.count({
      where: {
        shop,
        status: { in: ["SUBMITTED", "IN_REVIEW"] },
      },
    }),
    db.release.count({
      where: {
        shop,
        status: { not: "REJECTED" },
        distributionStatus: { not: "DELIVERED" },
        releaseDate: {
          gte: now,
          lte: sevenDays,
        },
      },
    }),
    db.operationJob.count({
      where: {
        shop,
        status: { in: ["QUEUED", "RUNNING"] },
      },
    }),
    db.operationJob.findMany({
      where: {
        shop,
        status: "FAILED",
        releaseId: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: {
        release: {
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
            files: {
              where: {
                trackId: null,
                kind: "COVER_ART",
              },
              select: {
                kind: true,
                url: true,
              },
              take: 1,
            },
            _count: {
              select: { tracks: true },
            },
          },
        },
      },
    }),
    countOpenSystemIssues({ shop }),
    listRecentSystemIssues({
      shop,
      take: 8,
      status: "OPEN",
    }),
  ]);

  const issues = [];

  for (const job of failedBackgroundJobs) {
    if (!job.release) continue;
    issues.push({
      key: `operation-job:${job.id}`,
      severity: "critical",
      requiresAction: true,
      category: "Background job",
      title: `${job.intent.replaceAll("-", " ")} failed`,
      message:
        job.lastError ||
        "A background release operation exhausted its retry budget.",
      href: `/app/distribution/${job.release.id}`,
      actionLabel: "Open distribution",
      release: {
        id: job.release.id,
        title: job.release.title,
        type: job.release.type,
        artistName: job.release.artistName,
        status: job.release.status,
        distributionStatus:
          job.release.distributionStatus,
        releaseDate: job.release.releaseDate,
        catalogNumber: job.release.catalogNumber,
        upc: job.release.upc,
        trackCount: job.release._count.tracks,
        files: job.release.files || [],
      },
    });
  }

  const readyToDistribute = [];
  const scheduled = [];

  for (const release of releases) {
    const analysis = operationalIssuesForRelease(
      release,
      settings || {},
      now,
    );

    issues.push(...analysis.issues);

    if (
      release.status === "APPROVED" &&
      release.distributionStatus === "NOT_QUEUED" &&
      analysis.readiness.ready &&
      latestSyncSignal(release)?.type !== "SHOPIFY_SYNC_FAILED"
    ) {
      readyToDistribute.push(releaseSummary(release));
    }

    if (
      analysis.releaseDays !== null &&
      analysis.releaseDays >= 0 &&
      analysis.releaseDays <= 7 &&
      release.distributionStatus !== "DELIVERED"
    ) {
      scheduled.push({
        ...releaseSummary(release),
        daysUntilRelease: analysis.releaseDays,
        ready: analysis.readiness.ready,
        blockerCount:
          analysis.readiness.blockers.length,
      });
    }
  }

  issues.sort((a, b) => {
    const priority =
      issuePriority(a) - issuePriority(b);
    if (priority !== 0) return priority;

    const aDate = a.release?.releaseDate
      ? new Date(a.release.releaseDate).getTime()
      : Number.MAX_SAFE_INTEGER;
    const bDate = b.release?.releaseDate
      ? new Date(b.release.releaseDate).getTime()
      : Number.MAX_SAFE_INTEGER;
    return aDate - bDate;
  });

  scheduled.sort(
    (a, b) =>
      new Date(a.releaseDate).getTime() -
      new Date(b.releaseDate).getTime(),
  );

  const actionable = issues.filter(
    (item) => item.requiresAction,
  );
  const advisories = issues.filter(
    (item) => !item.requiresAction,
  );

  return {
    checkedAt: now.toISOString(),
    capped: releases.length >= releaseLimit,
    stats: {
      needsAttention: new Set(
        actionable.map((item) => item.release.id),
      ).size,
      waitingReview,
      readyToDistribute: readyToDistribute.length,
      scheduledNextSevenDays,
      activeBackgroundJobs,
      openSystemIssues,
    },
    recentSystemIssues,
    issues: actionable.slice(0, issueLimit),
    advisories: advisories.slice(0, issueLimit),
    readyToDistribute: readyToDistribute.slice(0, 20),
    scheduled: scheduled.slice(0, 20),
  };
}
