-- M16.2: durable background operation queue and attempt history.

CREATE TABLE "OperationJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "deploymentProfile" TEXT NOT NULL DEFAULT 'releasecore',
    "releaseId" TEXT,
    "intent" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "fingerprint" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationJobAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "result" JSONB,

    CONSTRAINT "OperationJobAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationJob_shop_idempotencyKey_key"
ON "OperationJob"("shop", "idempotencyKey");

CREATE INDEX "OperationJob_deploymentProfile_status_availableAt_idx"
ON "OperationJob"("deploymentProfile", "status", "availableAt");

CREATE INDEX "OperationJob_shop_releaseId_createdAt_idx"
ON "OperationJob"("shop", "releaseId", "createdAt");

CREATE INDEX "OperationJob_shop_status_updatedAt_idx"
ON "OperationJob"("shop", "status", "updatedAt");

-- Database-level idempotency for concurrent replicas: only one active copy of
-- the same operation fingerprint may exist at a time.
CREATE UNIQUE INDEX "OperationJob_active_fingerprint_key"
ON "OperationJob"("deploymentProfile", "shop", "releaseId", "fingerprint")
WHERE "status" IN ('QUEUED', 'RUNNING');

-- Serialize external mutations for a release even if multiple Railway replicas
-- are draining the queue concurrently.
CREATE UNIQUE INDEX "OperationJob_one_running_release_key"
ON "OperationJob"("deploymentProfile", "releaseId")
WHERE "status" = 'RUNNING' AND "releaseId" IS NOT NULL;

CREATE UNIQUE INDEX "OperationJobAttempt_jobId_attempt_key"
ON "OperationJobAttempt"("jobId", "attempt");

CREATE INDEX "OperationJobAttempt_jobId_startedAt_idx"
ON "OperationJobAttempt"("jobId", "startedAt");

ALTER TABLE "OperationJob"
ADD CONSTRAINT "OperationJob_releaseId_fkey"
FOREIGN KEY ("releaseId")
REFERENCES "Release"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "OperationJobAttempt"
ADD CONSTRAINT "OperationJobAttempt_jobId_fkey"
FOREIGN KEY ("jobId")
REFERENCES "OperationJob"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
