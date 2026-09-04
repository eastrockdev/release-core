-- M16.5: first-party in-app feedback reports with privacy-minimized operational context.

CREATE TABLE "FeedbackReport" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "deploymentProfile" TEXT NOT NULL DEFAULT 'releasecore',
    "category" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "summary" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "pagePath" TEXT,
    "releaseId" TEXT,
    "trackId" TEXT,
    "systemIssueId" TEXT,
    "systemIssueRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeedbackReport_shop_deploymentProfile_createdAt_idx"
ON "FeedbackReport"("shop", "deploymentProfile", "createdAt");

CREATE INDEX "FeedbackReport_shop_status_createdAt_idx"
ON "FeedbackReport"("shop", "status", "createdAt");

CREATE INDEX "FeedbackReport_releaseId_createdAt_idx"
ON "FeedbackReport"("releaseId", "createdAt");

CREATE INDEX "FeedbackReport_trackId_createdAt_idx"
ON "FeedbackReport"("trackId", "createdAt");

CREATE INDEX "FeedbackReport_systemIssueId_createdAt_idx"
ON "FeedbackReport"("systemIssueId", "createdAt");

ALTER TABLE "FeedbackReport"
ADD CONSTRAINT "FeedbackReport_releaseId_fkey"
FOREIGN KEY ("releaseId")
REFERENCES "Release"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "FeedbackReport"
ADD CONSTRAINT "FeedbackReport_trackId_fkey"
FOREIGN KEY ("trackId")
REFERENCES "Track"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "FeedbackReport"
ADD CONSTRAINT "FeedbackReport_systemIssueId_fkey"
FOREIGN KEY ("systemIssueId")
REFERENCES "SystemIssue"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
