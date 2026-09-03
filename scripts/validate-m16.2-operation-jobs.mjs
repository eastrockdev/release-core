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
  "prisma/migrations/20260903233000_m16_2_operation_jobs/migration.sql",
);
const jobs = read("app/lib/operation-jobs.server.js");
const distributionApi = read(
  "app/routes/api.distribution.$releaseId.jsx",
);
const jobsApi = read(
  "app/routes/api.operation-jobs.$releaseId.jsx",
);
const internalDrain = read(
  "app/routes/internal.operation-jobs.drain.jsx",
);
const workspace = read(
  "app/lib/distribution-workspace.server.js",
);
const distributionUi = read(
  "app/routes/app.distribution_.$releaseId.jsx",
);
const operations = read(
  "app/lib/operations-center.server.js",
);
const operationsUi = read(
  "app/routes/app.operations.jsx",
);
const start = read("scripts/start-production.mjs");
const worker = read("scripts/operation-worker.mjs");
const packageJson = JSON.parse(read("package.json"));

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(
  schema,
  "model OperationJob {",
  "Prisma schema is missing OperationJob.",
);
need(
  schema,
  "model OperationJobAttempt {",
  "Prisma schema is missing OperationJobAttempt.",
);
need(
  schema,
  "operationJobs",
  "Release does not own background operation jobs.",
);
need(
  migration,
  'CREATE TABLE "OperationJob"',
  "OperationJob migration table is missing.",
);
need(
  migration,
  'CREATE TABLE "OperationJobAttempt"',
  "OperationJobAttempt migration table is missing.",
);
need(
  migration,
  "deploymentProfile",
  "Background jobs are not isolated by deployment profile.",
);
need(
  migration,
  "OperationJob_active_fingerprint_key",
  "Migration is missing database-level active-operation deduplication.",
);
need(
  migration,
  "OperationJob_one_running_release_key",
  "Migration is missing same-release running-job serialization.",
);

for (const marker of [
  "BACKGROUND_DISTRIBUTION_INTENTS",
  "enqueueDistributionOperation",
  "retryOperationJob",
  "drainOneOperationJob",
  "idempotencyKey",
  "fingerprint",
  "STALE_LEASE_MINUTES",
  "operationJobAttempt",
  "maxAttempts",
]) {
  need(
    jobs,
    marker,
    `Background job service is missing ${marker}.`,
  );
}

need(
  jobs,
  'status: "ABANDONED"',
  "Stale running attempts are not abandoned safely.",
);
need(
  jobs,
  "retryableError",
  "Background jobs do not classify automatic retries.",
);
need(
  jobs,
  "isUniqueConstraintError",
  "Background jobs do not handle concurrent database claim/dedupe races.",
);
need(
  jobs,
  "recordDistributionFailure",
  "Final background failures are not integrated with Sync Health.",
);

need(
  distributionApi,
  "isBackgroundDistributionIntent",
  "Distribution API does not route long operations to the queue.",
);
need(
  distributionApi,
  "enqueueDistributionOperation",
  "Distribution API does not enqueue background work.",
);
need(
  distributionApi,
  "status: 202",
  "Queued distribution operations do not return HTTP 202.",
);

need(
  jobsApi,
  'intent === "list"',
  "Operation job API cannot list release jobs.",
);
need(
  jobsApi,
  'intent === "retry"',
  "Operation job API cannot retry failed jobs.",
);
need(
  jobsApi,
  "authenticate.admin",
  "Operation job API is missing Shopify admin authentication.",
);

need(
  internalDrain,
  "timingSafeEqual",
  "Internal worker endpoint is missing constant-time secret validation.",
);
need(
  internalDrain,
  "RELEASECORE_WORKER_SECRET",
  "Internal worker endpoint is missing the runtime worker secret.",
);
need(
  internalDrain,
  "drainOneOperationJob",
  "Internal worker endpoint does not drain durable jobs.",
);

need(
  workspace,
  "operationJobs",
  "Distribution workspace does not load recent background operations.",
);
need(
  distributionUi,
  "Background operations",
  "Distribution workspace does not display background operations.",
);
need(
  distributionUi,
  "/api/operation-jobs/",
  "Distribution workspace does not poll the lightweight job endpoint.",
);
need(
  distributionUi,
  "idempotencyKey",
  "Distribution actions do not send an idempotency key.",
);

if (distributionUi.includes("globalThis.crypto")) {
  failures.push(
    "Distribution UI must not use the undeclared globalThis browser global; use window.crypto for the idempotency key.",
  );
}
need(
  distributionUi,
  "window.crypto?.randomUUID?.()",
  "Distribution UI does not use the browser crypto API for idempotency keys.",
);

need(
  operations,
  "activeBackgroundJobs",
  "Operations Center does not count active background jobs.",
);
need(
  operations,
  "failedBackgroundJobs",
  "Operations Center does not surface failed background jobs.",
);

const operationsLoaderIndex = operations.indexOf(
  "export async function loadOperationsCenter",
);
const operationsLoaderSource =
  operationsLoaderIndex === -1
    ? ""
    : operations.slice(operationsLoaderIndex);
if (
  operationsLoaderIndex === -1 ||
  !operationsLoaderSource.includes(
    "for (const job of failedBackgroundJobs)",
  )
) {
  failures.push(
    "Operations Center does not build failed background-job issues inside loadOperationsCenter.",
  );
}
if (
  operationsLoaderIndex > -1 &&
  operations
    .slice(0, operationsLoaderIndex)
    .includes("failedBackgroundJobs")
) {
  failures.push(
    "Operations Center references failedBackgroundJobs before loadOperationsCenter.",
  );
}
need(
  operationsUi,
  'label="Background jobs"',
  "Operations Center UI is missing the background-jobs metric.",
);

need(
  start,
  "RELEASECORE_WORKER_SECRET",
  "Production supervisor does not generate an internal worker secret.",
);
need(
  start,
  "operation-worker.mjs",
  "Production supervisor does not start the operation worker.",
);
need(
  worker,
  "/internal/operation-jobs/drain",
  "Operation worker does not call the internal drain endpoint.",
);

if (
  packageJson?.scripts?.["worker:operations"] !==
  "node scripts/operation-worker.mjs"
) {
  failures.push(
    "package.json is missing worker:operations.",
  );
}
if (
  packageJson?.scripts?.["check:m16.2"] !==
  "node scripts/validate-m16.2-operation-jobs.mjs"
) {
  failures.push("package.json is missing check:m16.2.");
}
if (
  !String(packageJson?.scripts?.check || "").includes(
    "npm run check:m16.2",
  )
) {
  failures.push(
    "Full npm run check does not include M16.2.",
  );
}
if (
  packageJson?.scripts?.["docker-start"] !==
  "npm run setup && node scripts/start-production.mjs"
) {
  failures.push(
    "docker-start does not launch the supervised web + worker runtime.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M16.2 durable operation-job validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M16.2 durable background jobs / idempotent retry validation passed.",
);
