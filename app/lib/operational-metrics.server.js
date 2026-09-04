import db from "../db.server";
import { deploymentProfileId } from "./deployment-profile.server";

const WINDOW_OPTIONS = new Set([7, 30, 90]);

const SYNC_SUCCESS_TYPES = [
  "SHOPIFY_PRODUCTS_SYNCED",
  "SHOPIFY_RELEASE_PRODUCT_SYNCED",
  "SHOPIFY_SYNC_RETRY_SUCCEEDED",
];
const SYNC_WARNING_TYPES = [
  "SHOPIFY_SYNC_WARNING",
  "SHOPIFY_PUBLICATION_WARNING",
];
const SYNC_FAILURE_TYPES = [
  "SHOPIFY_SYNC_FAILED",
];
const ALL_SYNC_TYPES = [
  ...SYNC_SUCCESS_TYPES,
  ...SYNC_WARNING_TYPES,
  ...SYNC_FAILURE_TYPES,
];

function countGroup(rows, key) {
  return Number(
    rows.find((row) => row.status === key)?._count?._all || 0,
  );
}

function sumGroup(rows) {
  return rows.reduce(
    (sum, row) => sum + Number(row._count?._all || 0),
    0,
  );
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(
      0,
      Math.ceil(sorted.length * fraction) - 1,
    ),
  );
  return sorted[index];
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function bucketKey(date, bucketDays) {
  const value = new Date(date);
  const utc = Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  );
  const bucketMs = bucketDays * 24 * 60 * 60 * 1000;
  return Math.floor(utc / bucketMs) * bucketMs;
}

function buildBuckets({
  start,
  end,
  bucketDays,
  events,
  classify,
}) {
  const bucketMs =
    bucketDays * 24 * 60 * 60 * 1000;
  const first = bucketKey(start, bucketDays);
  const last = bucketKey(end, bucketDays);
  const buckets = new Map();

  for (
    let timestamp = first;
    timestamp <= last;
    timestamp += bucketMs
  ) {
    buckets.set(timestamp, {
      start: new Date(timestamp).toISOString(),
      success: 0,
      warning: 0,
      failure: 0,
      total: 0,
    });
  }

  for (const event of events) {
    const timestamp = bucketKey(
      event.date,
      bucketDays,
    );
    const bucket = buckets.get(timestamp);
    if (!bucket) continue;
    const category = classify(event);
    if (
      ["success", "warning", "failure"].includes(
        category,
      )
    ) {
      bucket[category] += 1;
    }
    bucket.total += 1;
  }

  return [...buckets.values()];
}

function operationCountRows(rows) {
  return rows
    .map((row) => ({
      operation: row.operation,
      count: Number(row._count?._all || 0),
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.operation.localeCompare(b.operation),
    )
    .slice(0, 8);
}

export function operationalMetricsWindow(request) {
  const url = new URL(request.url);
  const requested = Number.parseInt(
    url.searchParams.get("days") || "30",
    10,
  );
  return WINDOW_OPTIONS.has(requested)
    ? requested
    : 30;
}

export async function loadOperationalMetrics({
  shop,
  days = 30,
  sampleLimit = 5000,
} = {}) {
  if (!shop) {
    throw new Error(
      "loadOperationalMetrics requires a shop.",
    );
  }

  const safeDays = WINDOW_OPTIONS.has(Number(days))
    ? Number(days)
    : 30;
  const now = new Date();
  const start = new Date(
    now.getTime() -
      safeDays * 24 * 60 * 60 * 1000,
  );
  const profile = deploymentProfileId();
  const boundedSample = Math.min(
    10000,
    Math.max(250, Number(sampleLimit) || 5000),
  );

  const [
    releasesCreated,
    releasesSubmitted,
    releasesApproved,
    releasesDelivered,
    jobCreatedGroups,
    jobCompletedGroups,
    jobAttemptAggregate,
    completedJobSample,
    activeJobGroups,
    oldestQueuedJob,
    newSystemIssues,
    touchedSystemIssueGroups,
    openSystemIssues,
    systemIssueOperations,
    syncSuccesses,
    syncWarnings,
    syncFailures,
    syncTrendRows,
    protectedMutationGroups,
    dataMaintenanceActions,
    notificationGroups,
  ] = await Promise.all([
    db.release.count({
      where: {
        shop,
        createdAt: { gte: start },
      },
    }),
    db.release.count({
      where: {
        shop,
        lastSubmittedAt: { gte: start },
      },
    }),
    db.release.count({
      where: {
        shop,
        status: "APPROVED",
        decisionAt: { gte: start },
      },
    }),
    db.release.count({
      where: {
        shop,
        distributionStatus: "DELIVERED",
        distributionUpdatedAt: { gte: start },
      },
    }),
    db.operationJob.groupBy({
      by: ["status"],
      where: {
        shop,
        deploymentProfile: profile,
        createdAt: { gte: start },
      },
      _count: { _all: true },
    }),
    db.operationJob.groupBy({
      by: ["status"],
      where: {
        shop,
        deploymentProfile: profile,
        completedAt: { gte: start },
        status: { in: ["SUCCEEDED", "FAILED"] },
      },
      _count: { _all: true },
    }),
    db.operationJob.aggregate({
      where: {
        shop,
        deploymentProfile: profile,
        completedAt: { gte: start },
        status: { in: ["SUCCEEDED", "FAILED"] },
      },
      _sum: { attempts: true },
    }),
    db.operationJob.findMany({
      where: {
        shop,
        deploymentProfile: profile,
        completedAt: { gte: start },
        startedAt: { not: null },
        status: { in: ["SUCCEEDED", "FAILED"] },
      },
      orderBy: { completedAt: "desc" },
      take: boundedSample,
      select: {
        id: true,
        intent: true,
        status: true,
        attempts: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    }),
    db.operationJob.groupBy({
      by: ["status"],
      where: {
        shop,
        deploymentProfile: profile,
        status: { in: ["QUEUED", "RUNNING"] },
      },
      _count: { _all: true },
    }),
    db.operationJob.findFirst({
      where: {
        shop,
        deploymentProfile: profile,
        status: "QUEUED",
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        availableAt: true,
      },
    }),
    db.systemIssue.count({
      where: {
        shop,
        deploymentProfile: profile,
        firstSeenAt: { gte: start },
      },
    }),
    db.systemIssue.groupBy({
      by: ["severity"],
      where: {
        shop,
        deploymentProfile: profile,
        lastSeenAt: { gte: start },
      },
      _count: { _all: true },
    }),
    db.systemIssue.count({
      where: {
        shop,
        deploymentProfile: profile,
        status: "OPEN",
      },
    }),
    db.systemIssue.groupBy({
      by: ["operation"],
      where: {
        shop,
        deploymentProfile: profile,
        lastSeenAt: { gte: start },
      },
      _count: { _all: true },
    }),
    db.submissionEvent.count({
      where: {
        release: { shop },
        createdAt: { gte: start },
        type: { in: SYNC_SUCCESS_TYPES },
      },
    }),
    db.submissionEvent.count({
      where: {
        release: { shop },
        createdAt: { gte: start },
        type: { in: SYNC_WARNING_TYPES },
      },
    }),
    db.submissionEvent.count({
      where: {
        release: { shop },
        createdAt: { gte: start },
        type: { in: SYNC_FAILURE_TYPES },
      },
    }),
    db.submissionEvent.findMany({
      where: {
        release: { shop },
        createdAt: { gte: start },
        type: { in: ALL_SYNC_TYPES },
      },
      orderBy: { createdAt: "desc" },
      take: boundedSample,
      select: {
        type: true,
        createdAt: true,
      },
    }),
    db.productionMutation.groupBy({
      by: ["operation"],
      where: {
        shop,
        deploymentProfile: profile,
        createdAt: { gte: start },
      },
      _count: { _all: true },
    }),
    db.dataMaintenanceEvent.count({
      where: {
        shop,
        deploymentProfile: profile,
        createdAt: { gte: start },
      },
    }),
    db.notificationDelivery.groupBy({
      by: ["status"],
      where: {
        shop,
        createdAt: { gte: start },
      },
      _count: { _all: true },
    }),
  ]);

  const jobsCreated = sumGroup(jobCreatedGroups);
  const jobsSucceeded = countGroup(
    jobCompletedGroups,
    "SUCCEEDED",
  );
  const jobsFailed = countGroup(
    jobCompletedGroups,
    "FAILED",
  );
  const jobsCompleted =
    jobsSucceeded + jobsFailed;
  const attemptTotal = Number(
    jobAttemptAggregate._sum.attempts || 0,
  );
  const retries = Math.max(
    0,
    attemptTotal - jobsCompleted,
  );

  const queueWaits = completedJobSample
    .filter(
      (job) => job.startedAt && job.createdAt,
    )
    .map((job) =>
      Math.max(
        0,
        new Date(job.startedAt).getTime() -
          new Date(job.createdAt).getTime(),
      ),
    );
  const runtimes = completedJobSample
    .filter(
      (job) => job.startedAt && job.completedAt,
    )
    .map((job) =>
      Math.max(
        0,
        new Date(job.completedAt).getTime() -
          new Date(job.startedAt).getTime(),
      ),
    );

  const queued = countGroup(
    activeJobGroups,
    "QUEUED",
  );
  const running = countGroup(
    activeJobGroups,
    "RUNNING",
  );

  const systemTouched = touchedSystemIssueGroups.reduce(
    (sum, row) =>
      sum + Number(row._count?._all || 0),
    0,
  );
  const systemCritical =
    touchedSystemIssueGroups
      .filter((row) =>
        ["CRITICAL", "ERROR"].includes(
          row.severity,
        ),
      )
      .reduce(
        (sum, row) =>
          sum + Number(row._count?._all || 0),
        0,
      );

  const protectedMutations =
    protectedMutationGroups.reduce(
      (sum, row) =>
        sum + Number(row._count?._all || 0),
      0,
    );

  const notificationCounts =
    Object.fromEntries(
      notificationGroups.map((row) => [
        row.status,
        Number(row._count?._all || 0),
      ]),
    );

  const bucketDays = safeDays > 30 ? 7 : 1;
  const syncTrend = buildBuckets({
    start,
    end: now,
    bucketDays,
    events: syncTrendRows.map((row) => ({
      date: row.createdAt,
      type: row.type,
    })),
    classify: (event) => {
      if (
        SYNC_SUCCESS_TYPES.includes(event.type)
      ) {
        return "success";
      }
      if (
        SYNC_WARNING_TYPES.includes(event.type)
      ) {
        return "warning";
      }
      return "failure";
    },
  });

  const jobTrend = buildBuckets({
    start,
    end: now,
    bucketDays,
    events: completedJobSample.map((job) => ({
      date: job.completedAt,
      status: job.status,
    })),
    classify: (event) =>
      event.status === "SUCCEEDED"
        ? "success"
        : "failure",
  });

  return {
    generatedAt: now.toISOString(),
    profile,
    window: {
      days: safeDays,
      start: start.toISOString(),
      end: now.toISOString(),
      bucketDays,
    },
    releaseThroughput: {
      created: releasesCreated,
      submitted: releasesSubmitted,
      approved: releasesApproved,
      delivered: releasesDelivered,
    },
    jobs: {
      created: jobsCreated,
      completed: jobsCompleted,
      succeeded: jobsSucceeded,
      failed: jobsFailed,
      successRate: rate(
        jobsSucceeded,
        jobsCompleted,
      ),
      retries,
      queued,
      running,
      oldestQueuedMs: oldestQueuedJob
        ? Math.max(
            0,
            now.getTime() -
              new Date(
                oldestQueuedJob.createdAt,
              ).getTime(),
          )
        : null,
      medianQueueWaitMs: percentile(
        queueWaits,
        0.5,
      ),
      p95QueueWaitMs: percentile(
        queueWaits,
        0.95,
      ),
      medianRuntimeMs: percentile(
        runtimes,
        0.5,
      ),
      p95RuntimeMs: percentile(
        runtimes,
        0.95,
      ),
      sampleSize: completedJobSample.length,
      sampleCapped:
        completedJobSample.length >=
        boundedSample,
      trend: jobTrend,
    },
    shopifySync: {
      successes: syncSuccesses,
      warnings: syncWarnings,
      failures: syncFailures,
      successRate: rate(
        syncSuccesses,
        syncSuccesses + syncFailures,
      ),
      trend: syncTrend,
      trendSampleSize: syncTrendRows.length,
      trendCapped:
        syncTrendRows.length >= boundedSample,
    },
    systemIssues: {
      open: openSystemIssues,
      new: newSystemIssues,
      touched: systemTouched,
      criticalOrError: systemCritical,
      topOperations:
        operationCountRows(systemIssueOperations),
    },
    protectedWrites: {
      total: protectedMutations,
      topOperations:
        operationCountRows(
          protectedMutationGroups,
        ),
    },
    maintenance: {
      actions: dataMaintenanceActions,
    },
    notifications: {
      total: Object.values(
        notificationCounts,
      ).reduce(
        (sum, value) => sum + value,
        0,
      ),
      sent:
        notificationCounts.SENT || 0,
      failed:
        notificationCounts.FAILED || 0,
      pending:
        notificationCounts.PENDING || 0,
    },
  };
}
