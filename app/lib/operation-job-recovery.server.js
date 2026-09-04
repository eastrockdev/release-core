import { randomUUID } from "node:crypto";
import process from "node:process";
import db from "../db.server";
import { publicError } from "./http-security.server";

export const MANUAL_RESTART_AFTER_MINUTES = 20;
const MANUAL_RESTART_AFTER_MS = MANUAL_RESTART_AFTER_MINUTES * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;

function deploymentProfile() {
  return String(
    process.env.RELEASECORE_DEPLOYMENT_PROFILE || "releasecore",
  )
    .trim()
    .toLowerCase();
}

function startedAtMs(job) {
  const value = job?.startedAt || job?.updatedAt || job?.createdAt;
  const stamp = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(stamp) ? stamp : null;
}

export function operationJobLooksStalled(job, now = Date.now()) {
  if (job?.status !== "RUNNING") return false;
  const started = startedAtMs(job);
  return started !== null && now - started >= MANUAL_RESTART_AFTER_MS;
}

export function decorateRestartableOperationJobs(jobs, now = Date.now()) {
  return (jobs || []).map((job) => {
    if (!operationJobLooksStalled(job, now)) return job;

    const message =
      `This operation has been running for more than ${MANUAL_RESTART_AFTER_MINUTES} minutes and may be stalled. ` +
      "You can restart it without waiting for the normal stale-lease recovery window.";

    return {
      ...job,
      restartable: true,
      restartReason: message,
      lastError: job.lastError ? `${message} ${job.lastError}` : message,
    };
  });
}

async function requireRelease(shop, releaseId) {
  const release = await db.release.findFirst({
    where: { id: releaseId, shop },
    select: { id: true },
  });
  if (!release) {
    throw publicError("Release not found.", { status: 404 });
  }
}

export async function restartStalledOperationJob({
  shop,
  releaseId,
  jobId,
}) {
  await requireRelease(shop, releaseId);

  const job = await db.operationJob.findFirst({
    where: {
      id: jobId,
      shop,
      releaseId,
      deploymentProfile: deploymentProfile(),
    },
  });

  if (!job) {
    throw publicError("Background operation not found.", { status: 404 });
  }

  if (job.status !== "RUNNING") {
    return { restarted: false, replacement: null };
  }

  if (!operationJobLooksStalled(job)) {
    throw publicError(
      `This background operation is still inside the ${MANUAL_RESTART_AFTER_MINUTES}-minute recovery window. Wait for it to finish or become restartable.`,
      { status: 409, code: "OPERATION_STILL_ACTIVE" },
    );
  }

  const now = new Date();
  const abandonedMessage =
    "Attempt abandoned by a Shopify administrator after the operation exceeded the stalled-job recovery window.";

  const replacement = await db.$transaction(async (tx) => {
    const claimed = await tx.operationJob.updateMany({
      where: {
        id: job.id,
        shop,
        releaseId,
        deploymentProfile: job.deploymentProfile,
        status: "RUNNING",
      },
      data: {
        status: "ABANDONED",
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: abandonedMessage,
      },
    });

    if (claimed.count !== 1) {
      throw publicError(
        "The background operation changed while ReleaseCore was restarting it. Refresh the workspace and try again if it is still stalled.",
        { status: 409, code: "OPERATION_RESTART_CONFLICT" },
      );
    }

    await tx.operationJobAttempt.updateMany({
      where: {
        jobId: job.id,
        status: "RUNNING",
      },
      data: {
        status: "ABANDONED",
        completedAt: now,
        error: abandonedMessage,
      },
    });

    return tx.operationJob.create({
      data: {
        shop: job.shop,
        deploymentProfile: job.deploymentProfile,
        releaseId: job.releaseId,
        intent: job.intent,
        status: "QUEUED",
        fingerprint: job.fingerprint,
        idempotencyKey: randomUUID(),
        payload: job.payload,
        maxAttempts: Math.max(job.maxAttempts, DEFAULT_MAX_ATTEMPTS),
        availableAt: now,
        lastError: "Restarted from a stalled background operation.",
      },
    });
  });

  return { restarted: true, replacement };
}