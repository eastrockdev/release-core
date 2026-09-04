import { createHash } from "node:crypto";
import process from "node:process";
import db from "../db.server";
import {
  classifyOperationalError,
} from "./operational-errors";

function deploymentProfile() {
  return String(
    process.env.RELEASECORE_DEPLOYMENT_PROFILE ||
      "releasecore",
  )
    .trim()
    .toLowerCase();
}

function fingerprintForIssue({
  source,
  operation,
  releaseId,
  trackId,
  operationJobId,
  classification,
}) {
  const stable = {
    source: String(source || "SERVER"),
    operation: String(operation || "request"),
    releaseId: releaseId || null,
    trackId: trackId || null,
    operationJobId: operationJobId || null,
    errorClass:
      classification.errorClass || "INTERNAL",
    errorCode:
      classification.errorCode || null,
    message: String(
      classification.safeMessage || "",
    ).slice(0, 500),
  };

  return createHash("sha256")
    .update(JSON.stringify(stable))
    .digest("hex");
}

export function serializeSystemIssue(issue) {
  if (!issue) return null;
  return {
    id: issue.id,
    source: issue.source,
    operation: issue.operation,
    severity: issue.severity,
    status: issue.status,
    releaseId: issue.releaseId,
    trackId: issue.trackId,
    operationJobId: issue.operationJobId,
    requestId: issue.requestId,
    errorClass: issue.errorClass,
    errorCode: issue.errorCode,
    safeMessage: issue.safeMessage,
    shopifyUserErrors:
      issue.shopifyUserErrors || [],
    retryable: issue.retryable,
    resolution: issue.resolution,
    occurrenceCount: issue.occurrenceCount,
    firstSeenAt: issue.firstSeenAt,
    lastSeenAt: issue.lastSeenAt,
    resolvedAt: issue.resolvedAt,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    release: issue.release
      ? {
          id: issue.release.id,
          title: issue.release.title,
          type: issue.release.type,
          artistName: issue.release.artistName,
          status: issue.release.status,
          distributionStatus:
            issue.release.distributionStatus,
        }
      : null,
  };
}

const ISSUE_INCLUDE = {
  release: {
    select: {
      id: true,
      title: true,
      type: true,
      artistName: true,
      status: true,
      distributionStatus: true,
    },
  },
};

export async function recordSystemIssue({
  shop,
  source = "SERVER",
  operation = "request",
  releaseId = null,
  trackId = null,
  operationJobId = null,
  requestId = null,
  error,
  classification = null,
}) {
  if (!shop) return null;

  const profile = deploymentProfile();
  const classified =
    classification ||
    classifyOperationalError(error);

  const fingerprint = fingerprintForIssue({
    source,
    operation,
    releaseId,
    trackId,
    operationJobId,
    classification: classified,
  });

  const now = new Date();

  const issue = await db.systemIssue.upsert({
    where: {
      shop_deploymentProfile_fingerprint: {
        shop,
        deploymentProfile: profile,
        fingerprint,
      },
    },
    create: {
      shop,
      deploymentProfile: profile,
      source: String(source || "SERVER"),
      operation: String(
        operation || "request",
      ).slice(0, 180),
      fingerprint,
      status: "OPEN",
      severity: classified.severity,
      releaseId: releaseId || null,
      trackId: trackId || null,
      operationJobId:
        operationJobId || null,
      requestId: requestId || null,
      errorClass: classified.errorClass,
      errorCode:
        classified.errorCode || null,
      safeMessage: classified.safeMessage,
      technicalMessage:
        classified.technicalMessage || null,
      shopifyUserErrors:
        classified.shopifyUserErrors || [],
      retryable:
        Boolean(classified.retryable),
      resolution:
        classified.resolution || null,
      occurrenceCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    },
    update: {
      status: "OPEN",
      severity: classified.severity,
      requestId: requestId || null,
      errorClass: classified.errorClass,
      errorCode:
        classified.errorCode || null,
      safeMessage: classified.safeMessage,
      technicalMessage:
        classified.technicalMessage || null,
      shopifyUserErrors:
        classified.shopifyUserErrors || [],
      retryable:
        Boolean(classified.retryable),
      resolution:
        classified.resolution || null,
      occurrenceCount: { increment: 1 },
      lastSeenAt: now,
      resolvedAt: null,
    },
    include: ISSUE_INCLUDE,
  });

  return serializeSystemIssue(issue);
}

export async function resolveSystemIssuesForOperation({
  shop,
  source,
  operation,
  releaseId = null,
  operationJobId = null,
}) {
  if (!shop) return 0;

  const where = {
    shop,
    deploymentProfile:
      deploymentProfile(),
    status: "OPEN",
    source,
    operation,
  };

  if (releaseId) where.releaseId = releaseId;
  if (operationJobId) {
    where.operationJobId = operationJobId;
  }

  const result = await db.systemIssue.updateMany({
    where,
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
    },
  });

  return result.count;
}

export async function markSystemIssueResolved({
  shop,
  issueId,
}) {
  const issue =
    await db.systemIssue.findFirst({
      where: {
        id: issueId,
        shop,
        deploymentProfile:
          deploymentProfile(),
      },
      include: ISSUE_INCLUDE,
    });

  if (!issue) return null;

  if (issue.status !== "RESOLVED") {
    const updated =
      await db.systemIssue.update({
        where: { id: issue.id },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
        },
        include: ISSUE_INCLUDE,
      });
    return serializeSystemIssue(updated);
  }

  return serializeSystemIssue(issue);
}

export async function listRecentSystemIssues({
  shop,
  take = 50,
  status = null,
}) {
  const where = {
    shop,
    deploymentProfile:
      deploymentProfile(),
  };

  if (status) where.status = status;

  const issues =
    await db.systemIssue.findMany({
      where,
      orderBy: [
        { status: "asc" },
        { lastSeenAt: "desc" },
      ],
      take,
      include: ISSUE_INCLUDE,
    });

  return issues.map(serializeSystemIssue);
}

export async function countOpenSystemIssues({
  shop,
}) {
  return db.systemIssue.count({
    where: {
      shop,
      deploymentProfile:
        deploymentProfile(),
      status: "OPEN",
    },
  });
}
