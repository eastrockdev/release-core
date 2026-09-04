import process from "node:process";
import db from "../db.server";
import {
  publicError,
  safeDiagnosticText,
} from "./http-security.server";

export const FEEDBACK_CATEGORIES = [
  "PROBLEM",
  "IMPROVEMENT",
  "FEATURE_REQUEST",
  "GENERAL",
];

export const FEEDBACK_IMPACTS = [
  "BLOCKING",
  "SIGNIFICANT",
  "MINOR",
  "SUGGESTION",
];

const MAX_RECENT_REPORTS_PER_HOUR = 20;

function deploymentProfile() {
  return String(
    process.env.RELEASECORE_DEPLOYMENT_PROFILE ||
      "releasecore",
  )
    .trim()
    .toLowerCase();
}

export function normalizeFeedbackPagePath(value) {
  let raw = String(value || "")
    .trim()
    .slice(0, 500);

  if (!raw) return null;

  try {
    if (/^https?:\/\//i.test(raw)) {
      raw = new URL(raw).pathname;
    }
  } catch {
    return null;
  }

  raw = raw.split("?")[0].split("#")[0];

  if (
    raw !== "/app" &&
    !raw.startsWith("/app/")
  ) {
    return null;
  }

  return raw.slice(0, 500);
}

function idsFromPagePath(pagePath) {
  const path =
    normalizeFeedbackPagePath(pagePath);

  if (!path) {
    return {
      releaseId: null,
      trackId: null,
    };
  }

  const releaseMatch = path.match(
    /^\/app\/(?:release|distribution)\/([^/]+)/,
  );
  const trackMatch = path.match(
    /\/track\/([^/]+)/,
  );

  return {
    releaseId:
      releaseMatch?.[1] || null,
    trackId: trackMatch?.[1] || null,
  };
}

function cleanRequiredText(
  value,
  {
    label,
    minLength,
    maxLength,
  },
) {
  const clean = safeDiagnosticText(
    String(value || "").trim(),
    maxLength,
  );

  if (clean.length < minLength) {
    throw publicError(
      `${label} must be at least ${minLength} characters.`,
      {
        status: 400,
        code: "FEEDBACK_INCOMPLETE",
      },
    );
  }

  return clean;
}

function normalizeCategory(value) {
  const category = String(
    value || "",
  ).toUpperCase();

  if (!FEEDBACK_CATEGORIES.includes(category)) {
    throw publicError(
      "Choose a valid feedback category.",
      {
        status: 400,
        code: "FEEDBACK_CATEGORY",
      },
    );
  }

  return category;
}

function normalizeImpact(value) {
  const impact = String(
    value || "",
  ).toUpperCase();

  if (!FEEDBACK_IMPACTS.includes(impact)) {
    throw publicError(
      "Choose how much this affects your work.",
      {
        status: 400,
        code: "FEEDBACK_IMPACT",
      },
    );
  }

  return impact;
}

export function feedbackReference(report) {
  const id = String(report?.id || "");
  return id
    ? `FB-${id.slice(-8).toUpperCase()}`
    : "FB";
}

async function resolvePageContext({
  shop,
  pagePath,
}) {
  const normalizedPath =
    normalizeFeedbackPagePath(pagePath);
  const parsed =
    idsFromPagePath(normalizedPath);

  let release = null;
  let track = null;

  if (parsed.releaseId) {
    release = await db.release.findFirst({
      where: {
        id: parsed.releaseId,
        shop,
      },
      select: {
        id: true,
        title: true,
        type: true,
        artistName: true,
      },
    });
  }

  if (release && parsed.trackId) {
    track = await db.track.findFirst({
      where: {
        id: parsed.trackId,
        releaseId: release.id,
      },
      select: {
        id: true,
        position: true,
        title: true,
      },
    });
  }

  return {
    pagePath: normalizedPath,
    release,
    track,
  };
}

async function resolveSystemIssue({
  shop,
  systemIssueId,
}) {
  const id = String(
    systemIssueId || "",
  ).trim();

  if (!id) return null;

  return db.systemIssue.findFirst({
    where: {
      id,
      shop,
      deploymentProfile:
        deploymentProfile(),
    },
    select: {
      id: true,
      requestId: true,
      errorClass: true,
      safeMessage: true,
      releaseId: true,
      trackId: true,
      status: true,
      lastSeenAt: true,
    },
  });
}

export async function resolveFeedbackContext({
  shop,
  pagePath = null,
  systemIssueId = null,
}) {
  const [page, systemIssue] =
    await Promise.all([
      resolvePageContext({
        shop,
        pagePath,
      }),
      resolveSystemIssue({
        shop,
        systemIssueId,
      }),
    ]);

  let release = page.release;
  let track = page.track;

  if (!release && systemIssue?.releaseId) {
    release = await db.release.findFirst({
      where: {
        id: systemIssue.releaseId,
        shop,
      },
      select: {
        id: true,
        title: true,
        type: true,
        artistName: true,
      },
    });
  }

  if (
    !track &&
    release &&
    systemIssue?.trackId
  ) {
    track = await db.track.findFirst({
      where: {
        id: systemIssue.trackId,
        releaseId: release.id,
      },
      select: {
        id: true,
        position: true,
        title: true,
      },
    });
  }

  return {
    pagePath: page.pagePath,
    release,
    track,
    systemIssue,
  };
}

function serializeFeedback(report) {
  return {
    id: report.id,
    reference: feedbackReference(report),
    category: report.category,
    impact: report.impact,
    status: report.status,
    summary: report.summary,
    message: report.message,
    pagePath: report.pagePath,
    releaseId: report.releaseId,
    trackId: report.trackId,
    systemIssueId: report.systemIssueId,
    systemIssueRequestId:
      report.systemIssueRequestId,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    release: report.release
      ? {
          id: report.release.id,
          title: report.release.title,
          type: report.release.type,
          artistName:
            report.release.artistName,
        }
      : null,
    track: report.track
      ? {
          id: report.track.id,
          position: report.track.position,
          title: report.track.title,
        }
      : null,
  };
}

const FEEDBACK_INCLUDE = {
  release: {
    select: {
      id: true,
      title: true,
      type: true,
      artistName: true,
    },
  },
  track: {
    select: {
      id: true,
      position: true,
      title: true,
    },
  },
};

export async function createFeedbackReport({
  shop,
  category,
  impact,
  summary,
  message,
  pagePath = null,
  systemIssueId = null,
}) {
  if (!shop) {
    throw publicError(
      "ReleaseCore could not identify this store.",
      { status: 400 },
    );
  }

  const hourAgo = new Date(
    Date.now() - 60 * 60 * 1000,
  );
  const recentCount =
    await db.feedbackReport.count({
      where: {
        shop,
        deploymentProfile:
          deploymentProfile(),
        createdAt: {
          gte: hourAgo,
        },
      },
    });

  if (
    recentCount >=
    MAX_RECENT_REPORTS_PER_HOUR
  ) {
    throw publicError(
      "Feedback is being submitted too quickly. Try again later.",
      {
        status: 429,
        code: "FEEDBACK_RATE_LIMIT",
      },
    );
  }

  const normalizedCategory =
    normalizeCategory(category);
  const normalizedImpact =
    normalizeImpact(impact);
  const cleanSummary = cleanRequiredText(
    summary,
    {
      label: "Summary",
      minLength: 5,
      maxLength: 160,
    },
  );
  const cleanMessage = cleanRequiredText(
    message,
    {
      label: "Details",
      minLength: 10,
      maxLength: 4000,
    },
  );

  const context =
    await resolveFeedbackContext({
      shop,
      pagePath,
      systemIssueId,
    });

  const created =
    await db.feedbackReport.create({
      data: {
        shop,
        deploymentProfile:
          deploymentProfile(),
        category: normalizedCategory,
        impact: normalizedImpact,
        status: "RECEIVED",
        summary: cleanSummary,
        message: cleanMessage,
        pagePath:
          context.pagePath || null,
        releaseId:
          context.release?.id || null,
        trackId:
          context.track?.id || null,
        systemIssueId:
          context.systemIssue?.id || null,
        systemIssueRequestId:
          context.systemIssue?.requestId ||
          null,
      },
      include: FEEDBACK_INCLUDE,
    });

  return serializeFeedback(created);
}

export async function listFeedbackReports({
  shop,
  take = 12,
}) {
  const reports =
    await db.feedbackReport.findMany({
      where: {
        shop,
        deploymentProfile:
          deploymentProfile(),
      },
      orderBy: {
        createdAt: "desc",
      },
      take,
      include: FEEDBACK_INCLUDE,
    });

  return reports.map(serializeFeedback);
}
