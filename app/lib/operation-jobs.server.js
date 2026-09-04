import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { performDistributionAction } from "./distribution.server";
import { recordDistributionFailure } from "./distribution-health.server";
import {
  publicError,
  safeDiagnosticText,
} from "./http-security.server";
import {
  recordSystemIssue,
  resolveSystemIssuesForOperation,
} from "./system-issues.server";

export const BACKGROUND_DISTRIBUTION_INTENTS = new Set([
  "generate-audio-previews",
  "retry-sync-health",
  "orchestrate-publication",
  "create-shopify-products",
  "sync-shopify-release-product",
  "publish-shopify-product",
  "schedule-shopify-product",
  "unpublish-shopify-product",
  "publish-shopify-release-product",
  "schedule-shopify-release-product",
  "unpublish-shopify-release-product",
]);

const ACTIVE_JOB_STATUSES = ["QUEUED", "RUNNING"];
const STALE_LEASE_MINUTES = 45;
const DEFAULT_MAX_ATTEMPTS = 3;

function isUniqueConstraintError(error) {
  return error?.code === "P2002";
}

export function isBackgroundDistributionIntent(intent) {
  return BACKGROUND_DISTRIBUTION_INTENTS.has(
    String(intent || ""),
  );
}

export function operationIntentLabel(intent) {
  return (
    {
      "generate-audio-previews": "Generate audio previews",
      "retry-sync-health": "Retry Sync Health",
      "orchestrate-publication": "Storefront publication",
      "create-shopify-products": "Shopify track product sync",
      "sync-shopify-release-product":
        "Album / EP product and bundle sync",
      "publish-shopify-product": "Publish track product",
      "schedule-shopify-product": "Schedule track product",
      "unpublish-shopify-product": "Unpublish track product",
      "publish-shopify-release-product":
        "Publish Album / EP product",
      "schedule-shopify-release-product":
        "Schedule Album / EP product",
      "unpublish-shopify-release-product":
        "Unpublish Album / EP product",
    }[String(intent || "")] ||
    String(intent || "Background operation")
      .replaceAll("-", " ")
  );
}

function deploymentProfile() {
  return String(
    process.env.RELEASECORE_DEPLOYMENT_PROFILE ||
      "releasecore",
  )
    .trim()
    .toLowerCase();
}

function stableObject(value) {
  if (Array.isArray(value)) {
    return value.map(stableObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableObject(item)]),
    );
  }
  return value;
}

function payloadFingerprint({
  profile,
  shop,
  releaseId,
  intent,
  payload,
}) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        stableObject({
          profile,
          shop,
          releaseId,
          intent,
          payload,
        }),
      ),
    )
    .digest("hex");
}

function serializeFormData(formData) {
  const payload = {};
  for (const [key, value] of formData.entries()) {
    if (key === "intent" || key === "idempotencyKey") {
      continue;
    }
    if (typeof value !== "string") {
      throw publicError(
        "Background operations cannot queue uploaded files.",
        { status: 400 },
      );
    }
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const previous = payload[key];
      payload[key] = Array.isArray(previous)
        ? [...previous, value]
        : [previous, value];
    } else {
      payload[key] = value;
    }
  }
  return payload;
}

function appendPayload(formData, payload = {}) {
  for (const [key, value] of Object.entries(payload || {})) {
    if (Array.isArray(value)) {
      value.forEach((item) =>
        formData.append(key, String(item)),
      );
    } else if (value !== null && value !== undefined) {
      formData.set(key, String(value));
    }
  }
}

export function serializeOperationJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    releaseId: job.releaseId,
    intent: job.intent,
    label: operationIntentLabel(job.intent),
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    availableAt: job.availableAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    lastError: job.lastError || null,
    result: job.result || null,
    attemptLog: (job.attemptLog || []).map((attempt) => ({
      id: attempt.id,
      attempt: attempt.attempt,
      status: attempt.status,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      error: attempt.error || null,
    })),
  };
}

const JOB_VIEW_INCLUDE = {
  attemptLog: {
    orderBy: { attempt: "desc" },
    take: 5,
  },
};

async function requireShopRelease(shop, releaseId) {
  const release = await db.release.findFirst({
    where: { id: releaseId, shop },
    select: { id: true },
  });
  if (!release) {
    throw publicError("Release not found.", {
      status: 404,
    });
  }
  return release;
}

export async function listReleaseOperationJobs({
  shop,
  releaseId,
  take = 10,
}) {
  await requireShopRelease(shop, releaseId);
  const jobs = await db.operationJob.findMany({
    where: {
      shop,
      releaseId,
      deploymentProfile: deploymentProfile(),
    },
    orderBy: { createdAt: "desc" },
    take,
    include: JOB_VIEW_INCLUDE,
  });
  return jobs.map(serializeOperationJob);
}

export async function enqueueDistributionOperation({
  shop,
  releaseId,
  intent,
  formData,
}) {
  if (!isBackgroundDistributionIntent(intent)) {
    throw publicError(
      "That distribution action is not configured for background execution.",
      { status: 400 },
    );
  }

  await requireShopRelease(shop, releaseId);

  const profile = deploymentProfile();
  const payload = serializeFormData(formData);
  const fingerprint = payloadFingerprint({
    profile,
    shop,
    releaseId,
    intent,
    payload,
  });
  const requestedIdempotencyKey = String(
    formData.get("idempotencyKey") || "",
  ).trim();
  const idempotencyKey =
    requestedIdempotencyKey || randomUUID();

  if (requestedIdempotencyKey) {
    const previous = await db.operationJob.findFirst({
      where: {
        shop,
        deploymentProfile: profile,
        idempotencyKey: requestedIdempotencyKey,
      },
      include: JOB_VIEW_INCLUDE,
    });
    if (previous) {
      return {
        job: serializeOperationJob(previous),
        reused: true,
      };
    }
  }

  const active = await db.operationJob.findFirst({
    where: {
      shop,
      deploymentProfile: profile,
      releaseId,
      fingerprint,
      status: { in: ACTIVE_JOB_STATUSES },
    },
    orderBy: { createdAt: "desc" },
    include: JOB_VIEW_INCLUDE,
  });

  if (active) {
    return {
      job: serializeOperationJob(active),
      reused: true,
    };
  }

  try {
    const created = await db.operationJob.create({
      data: {
        shop,
        deploymentProfile: profile,
        releaseId,
        intent,
        status: "QUEUED",
        fingerprint,
        idempotencyKey,
        payload,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
      },
      include: JOB_VIEW_INCLUDE,
    });

    return {
      job: serializeOperationJob(created),
      reused: false,
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const activeAfterRace =
        await db.operationJob.findFirst({
          where: {
            shop,
            deploymentProfile: profile,
            releaseId,
            fingerprint,
            status: { in: ACTIVE_JOB_STATUSES },
          },
          orderBy: { createdAt: "desc" },
          include: JOB_VIEW_INCLUDE,
        });
      if (activeAfterRace) {
        return {
          job: serializeOperationJob(activeAfterRace),
          reused: true,
        };
      }
    }

    if (requestedIdempotencyKey) {
      const previous = await db.operationJob.findFirst({
        where: {
          shop,
          deploymentProfile: profile,
          idempotencyKey: requestedIdempotencyKey,
        },
        include: JOB_VIEW_INCLUDE,
      });
      if (previous) {
        return {
          job: serializeOperationJob(previous),
          reused: true,
        };
      }
    }
    throw error;
  }
}

export async function retryOperationJob({
  shop,
  releaseId,
  jobId,
}) {
  await requireShopRelease(shop, releaseId);

  const job = await db.operationJob.findFirst({
    where: {
      id: jobId,
      shop,
      releaseId,
      deploymentProfile: deploymentProfile(),
    },
  });

  if (!job) {
    throw publicError("Background operation not found.", {
      status: 404,
    });
  }

  if (ACTIVE_JOB_STATUSES.includes(job.status)) {
    return serializeOperationJob(
      await db.operationJob.findUnique({
        where: { id: job.id },
        include: JOB_VIEW_INCLUDE,
      }),
    );
  }

  if (job.status !== "FAILED") {
    throw publicError(
      "Only failed background operations can be retried.",
      { status: 409 },
    );
  }

  const activeReplacement =
    await db.operationJob.findFirst({
      where: {
        id: { not: job.id },
        shop,
        deploymentProfile: job.deploymentProfile,
        releaseId,
        fingerprint: job.fingerprint,
        status: { in: ACTIVE_JOB_STATUSES },
      },
      include: JOB_VIEW_INCLUDE,
    });

  if (activeReplacement) {
    return serializeOperationJob(activeReplacement);
  }

  const updated = await db.operationJob.update({
    where: { id: job.id },
    data: {
      status: "QUEUED",
      availableAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      completedAt: null,
      maxAttempts: Math.max(
        job.maxAttempts,
        job.attempts + DEFAULT_MAX_ATTEMPTS,
      ),
    },
    include: JOB_VIEW_INCLUDE,
  });

  return serializeOperationJob(updated);
}

async function abandonStaleLeases(profile) {
  const cutoff = new Date(
    Date.now() -
      STALE_LEASE_MINUTES * 60 * 1000,
  );

  const stale = await db.operationJob.findMany({
    where: {
      deploymentProfile: profile,
      status: "RUNNING",
      lockedAt: { lt: cutoff },
    },
    select: { id: true },
    take: 100,
  });

  if (!stale.length) return 0;

  const ids = stale.map((job) => job.id);
  const now = new Date();

  await db.$transaction([
    db.operationJobAttempt.updateMany({
      where: {
        jobId: { in: ids },
        status: "RUNNING",
      },
      data: {
        status: "ABANDONED",
        completedAt: now,
        error:
          "Worker lease expired before the attempt completed.",
      },
    }),
    db.operationJob.updateMany({
      where: {
        id: { in: ids },
        deploymentProfile: profile,
        status: "RUNNING",
        lockedAt: { lt: cutoff },
      },
      data: {
        status: "QUEUED",
        lockedAt: null,
        lockedBy: null,
        availableAt: now,
        lastError:
          "Previous worker lease expired; operation was requeued safely.",
      },
    }),
  ]);

  return ids.length;
}

async function claimNextJob({
  profile,
  workerId,
}) {
  await abandonStaleLeases(profile);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = await db.operationJob.findFirst({
      where: {
        deploymentProfile: profile,
        status: "QUEUED",
        availableAt: { lte: new Date() },
      },
      orderBy: [
        { availableAt: "asc" },
        { createdAt: "asc" },
      ],
      select: { id: true },
    });

    if (!candidate) return null;

    const now = new Date();
    let claimed = null;
    try {
      claimed = await db.operationJob.updateMany({
        where: {
          id: candidate.id,
          deploymentProfile: profile,
          status: "QUEUED",
          lockedAt: null,
        },
        data: {
          status: "RUNNING",
          lockedAt: now,
          lockedBy: workerId,
          startedAt: now,
          attempts: { increment: 1 },
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        continue;
      }
      throw error;
    }

    if (!claimed.count) continue;

    const job = await db.operationJob.findUnique({
      where: { id: candidate.id },
      include: JOB_VIEW_INCLUDE,
    });

    if (!job) continue;

    await db.operationJobAttempt.create({
      data: {
        jobId: job.id,
        attempt: job.attempts,
        status: "RUNNING",
        startedAt: now,
      },
    });

    return job;
  }

  return null;
}

function retryDelayMs(attempt) {
  if (attempt <= 1) return 5_000;
  if (attempt === 2) return 20_000;
  return 60_000;
}

function retryableError(error) {
  const status = Number(error?.status || 0);
  if (status >= 400 && status < 500) {
    return status === 408 || status === 429;
  }
  return true;
}

async function finishAttempt({
  job,
  status,
  result = null,
  error = null,
}) {
  await db.operationJobAttempt.updateMany({
    where: {
      jobId: job.id,
      attempt: job.attempts,
      status: "RUNNING",
    },
    data: {
      status,
      completedAt: new Date(),
      result,
      error,
    },
  });
}

async function markJobSucceeded(job, result) {
  await finishAttempt({
    job,
    status: "SUCCEEDED",
    result,
  });

  const completed =
    await db.operationJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        result,
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
      include: JOB_VIEW_INCLUDE,
    });

  await resolveSystemIssuesForOperation({
    shop: job.shop,
    source: "BACKGROUND_JOB",
    operation: job.intent,
    releaseId: job.releaseId,
    operationJobId: job.id,
  });

  return completed;
}

async function markJobFailed({
  job,
  error,
  retryable,
}) {
  const message = safeDiagnosticText(
    error instanceof Error
      ? error.message
      : String(error || "Background operation failed."),
    1600,
  );

  await finishAttempt({
    job,
    status: "FAILED",
    error: message,
  });

  if (retryable && job.attempts < job.maxAttempts) {
    return db.operationJob.update({
      where: { id: job.id },
      data: {
        status: "QUEUED",
        availableAt: new Date(
          Date.now() + retryDelayMs(job.attempts),
        ),
        lockedAt: null,
        lockedBy: null,
        lastError: message,
      },
      include: JOB_VIEW_INCLUDE,
    });
  }

  try {
    await recordSystemIssue({
      shop: job.shop,
      source: "BACKGROUND_JOB",
      operation: job.intent,
      releaseId: job.releaseId,
      operationJobId: job.id,
      requestId:
        `job_${job.id}_${job.attempts}`,
      error,
    });
  } catch (issueError) {
    console.warn(
      "ReleaseCore background system issue could not be saved",
      {
        message: safeDiagnosticText(
          issueError instanceof Error
            ? issueError.message
            : issueError,
          700,
        ),
      },
    );
  }

  try {
    await recordDistributionFailure({
      shop: job.shop,
      releaseId: job.releaseId,
      intent: job.intent,
      error,
    });
  } catch (loggingError) {
    console.warn(
      "ReleaseCore background-operation failure event could not be saved",
      {
        message: safeDiagnosticText(
          loggingError instanceof Error
            ? loggingError.message
            : loggingError,
          700,
        ),
      },
    );
  }

  return db.operationJob.update({
    where: { id: job.id },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: message,
    },
    include: JOB_VIEW_INCLUDE,
  });
}

export async function drainOneOperationJob({
  profile = deploymentProfile(),
  workerId = `worker-${randomUUID()}`,
} = {}) {
  const normalizedProfile = String(profile || "")
    .trim()
    .toLowerCase();

  const job = await claimNextJob({
    profile: normalizedProfile,
    workerId,
  });

  if (!job) {
    return {
      processed: false,
      job: null,
    };
  }

  try {
    const { admin } = await unauthenticated.admin(
      job.shop,
    );

    const formData = new FormData();
    formData.set("intent", job.intent);
    appendPayload(formData, job.payload);

    const result = await performDistributionAction({
      admin,
      shop: job.shop,
      releaseId: job.releaseId,
      formData,
    });

    const completed = await markJobSucceeded(
      job,
      result || {},
    );

    return {
      processed: true,
      job: serializeOperationJob(completed),
    };
  } catch (error) {
    const failed = await markJobFailed({
      job,
      error,
      retryable: retryableError(error),
    });

    return {
      processed: true,
      job: serializeOperationJob(failed),
    };
  }
}
