-- M16.4: durable, safe production system issue history.

CREATE TABLE "SystemIssue" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "deploymentProfile" TEXT NOT NULL DEFAULT 'releasecore',
    "source" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL DEFAULT 'ERROR',
    "releaseId" TEXT,
    "trackId" TEXT,
    "operationJobId" TEXT,
    "requestId" TEXT,
    "errorClass" TEXT NOT NULL,
    "errorCode" TEXT,
    "safeMessage" TEXT NOT NULL,
    "technicalMessage" TEXT,
    "shopifyUserErrors" JSONB,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "resolution" TEXT,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemIssue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SystemIssue_shop_deploymentProfile_fingerprint_key"
ON "SystemIssue"("shop", "deploymentProfile", "fingerprint");

CREATE INDEX "SystemIssue_shop_deploymentProfile_status_lastSeenAt_idx"
ON "SystemIssue"("shop", "deploymentProfile", "status", "lastSeenAt");

CREATE INDEX "SystemIssue_shop_deploymentProfile_lastSeenAt_idx"
ON "SystemIssue"("shop", "deploymentProfile", "lastSeenAt");

CREATE INDEX "SystemIssue_releaseId_lastSeenAt_idx"
ON "SystemIssue"("releaseId", "lastSeenAt");

CREATE INDEX "SystemIssue_operationJobId_idx"
ON "SystemIssue"("operationJobId");

ALTER TABLE "SystemIssue"
ADD CONSTRAINT "SystemIssue_releaseId_fkey"
FOREIGN KEY ("releaseId")
REFERENCES "Release"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
