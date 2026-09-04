#!/usr/bin/env node
import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const schema = read("prisma/schema.prisma");
const migration = read(
  "prisma/migrations/20260904033000_m16_5_feedback_reports/migration.sql",
);
const service = read(
  "app/lib/feedback-reports.server.js",
);
const route = read(
  "app/routes/app.feedback.jsx",
);
const app = read("app/routes/app.jsx");
const settingsHub = read(
  "app/routes/app.settings.jsx",
);
const issues = read(
  "app/routes/app.system-issues.jsx",
);
const css = read(
  "app/styles/releasecore-admin.css",
);
const pkg = JSON.parse(read("package.json"));

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) {
    failures.push(message);
  }
};
const needMatch = (source, pattern, message) => {
  if (!pattern.test(source)) {
    failures.push(message);
  }
};

need(
  schema,
  "model FeedbackReport {",
  "Prisma schema is missing FeedbackReport.",
);
need(
  schema,
  "feedbackReports",
  "Release/Track/SystemIssue feedback relations are missing.",
);
need(
  schema,
  "systemIssueRequestId",
  "Feedback schema is missing systemIssueRequestId.",
);
needMatch(
  schema,
  /\bsystemIssue\s+SystemIssue\?\s+@relation\(/,
  "Feedback schema is missing the optional SystemIssue relation.",
);

need(
  migration,
  'CREATE TABLE "FeedbackReport"',
  "FeedbackReport migration table is missing.",
);
need(
  migration,
  '"systemIssueId"',
  "FeedbackReport migration does not support System Issue context.",
);

for (const marker of [
  "FEEDBACK_CATEGORIES",
  "FEEDBACK_IMPACTS",
  "normalizeFeedbackPagePath",
  "createFeedbackReport",
  "resolveFeedbackContext",
  "listFeedbackReports",
  "safeDiagnosticText",
  "MAX_RECENT_REPORTS_PER_HOUR",
  "FEEDBACK_RATE_LIMIT",
]) {
  need(
    service,
    marker,
    `Feedback service is missing ${marker}.`,
  );
}

for (const forbidden of [
  "session.email",
  "session.firstName",
  "session.lastName",
  "user-agent",
  "userAgent",
  "request.headers",
  "ipAddress",
]) {
  if (
    service.includes(forbidden) ||
    route.includes(forbidden)
  ) {
    failures.push(
      `Feedback must not capture staff/request identity data: ${forbidden}.`,
    );
  }
}

needMatch(
  service,
  /raw\.split\(\s*"\?"\s*\)\[0\]\.split\(\s*"#"\s*\)\[0\]/,
  "Feedback page context does not discard query/hash data.",
);
needMatch(
  service,
  /pagePath\s*:\s*context\.pagePath\s*\|\|\s*null/,
  "Feedback report does not persist the sanitized page path.",
);

for (const marker of [
  'heading="Feedback"',
  'name="category"',
  'name="impact"',
  'name="summary"',
  'name="message"',
  'name="systemIssueId"',
  "Context included automatically",
  "Recent feedback from this store",
  "Do not include passwords",
]) {
  need(
    route,
    marker,
    `Feedback page is missing ${marker}.`,
  );
}
needMatch(
  route,
  /feedback\s+reference/i,
  "Feedback page does not explain the feedback reference returned after submission.",
);
need(
  route,
  "reference: report.reference",
  "Feedback submission does not return the generated feedback reference.",
);

need(
  settingsHub,
  "/app/feedback?from=%2Fapp%2Fsettings",
  "Settings hub does not expose Feedback.",
);

need(
  issues,
  "Report this issue",
  "System Issues page cannot open Feedback with issue context.",
);
need(
  issues,
  "systemIssue=${issue.id}",
  "System Issues feedback link does not preserve the issue reference.",
);

for (const marker of [
  ".rc-feedback-form",
  ".rc-feedback-context",
  ".rc-feedback-report",
]) {
  need(
    css,
    marker,
    `Feedback CSS is missing ${marker}.`,
  );
}

if (
  pkg?.scripts?.["check:m16.5"] !==
  "node scripts/validate-m16.5-feedback.mjs"
) {
  failures.push(
    "package.json is missing check:m16.5.",
  );
}
if (
  !String(pkg?.scripts?.check || "").includes(
    "npm run check:m16.5",
  )
) {
  failures.push(
    "Full npm run check does not include M16.5.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M16.5 feedback validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M16.5 built-in feedback / privacy-minimized context validation passed.",
);
