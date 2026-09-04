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
  "prisma/migrations/20260904110000_m16_9_operational_metrics_indexes/migration.sql",
);
const metrics = read(
  "app/lib/operational-metrics.server.js",
);
const route = read(
  "app/routes/app.operations.metrics.jsx",
);
const operations = read(
  "app/routes/app.operations.jsx",
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

for (const marker of [
  "loadOperationalMetrics",
  "operationalMetricsWindow",
  "deploymentProfileId",
  "db.operationJob.groupBy",
  "db.operationJob.aggregate",
  "db.systemIssue.groupBy",
  "db.productionMutation.groupBy",
  "db.dataMaintenanceEvent.count",
  "db.notificationDelivery.groupBy",
  "SYNC_SUCCESS_TYPES",
  "SYNC_WARNING_TYPES",
  "SYNC_FAILURE_TYPES",
  "medianQueueWaitMs",
  "p95RuntimeMs",
  "oldestQueuedMs",
  "successRate",
]) {
  need(
    metrics,
    marker,
    `Operational metrics service is missing ${marker}.`,
  );
}

if (
  metrics.includes("admin.graphql") ||
  metrics.includes("unauthenticated.admin")
) {
  failures.push(
    "Operational metrics must not call Shopify or perform external writes.",
  );
}

for (const marker of [
  'heading="Operational Metrics"',
  "Operational snapshot",
  "Release throughput",
  "Background jobs",
  "Shopify sync reliability",
  "Diagnostics & communication",
  "TrendChart",
  'href="/app/production-safety"',
]) {
  need(
    route,
    marker,
    `Operational Metrics page is missing ${marker}.`,
  );
}

need(
  operations,
  "/app/operations/metrics",
  "Operations Center does not link to Operational Metrics.",
);

for (const marker of [
  "@@index([shop, decisionAt])",
  "@@index([shop, deploymentProfile, createdAt])",
  "@@index([shop, deploymentProfile, completedAt])",
  "@@index([shop, deploymentProfile, firstSeenAt])",
  "@@index([type, createdAt])",
  "@@index([shop, status, createdAt])",
]) {
  need(
    schema,
    marker,
    `Prisma metrics index is missing ${marker}.`,
  );
}

for (const marker of [
  '"Release_shop_decisionAt_idx"',
  '"OperationJob_shop_deploymentProfile_createdAt_idx"',
  '"OperationJob_shop_deploymentProfile_completedAt_idx"',
  '"SystemIssue_shop_deploymentProfile_firstSeenAt_idx"',
  '"SubmissionEvent_type_createdAt_idx"',
  '"NotificationDelivery_shop_status_createdAt_idx"',
]) {
  need(
    migration,
    marker,
    `M16.9 migration is missing ${marker}.`,
  );
}

for (const marker of [
  ".rc-metrics-window",
  ".rc-metrics-chart",
  ".rc-metrics-chart__plot",
  ".rc-metrics-two-column",
  ".rc-metrics-operation-row",
]) {
  need(
    css,
    marker,
    `M16.9 metrics CSS is missing ${marker}.`,
  );
}

if (
  pkg?.scripts?.["check:m16.9"] !==
  "node scripts/validate-m16.9-operational-metrics.mjs"
) {
  failures.push(
    "package.json is missing check:m16.9.",
  );
}

if (
  !String(pkg?.scripts?.check || "").includes(
    "npm run check:m16.9",
  )
) {
  failures.push(
    "Full npm run check does not include M16.9.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M16.9 operational metrics validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M16.9 operational metrics / reliability telemetry validation passed.",
);
