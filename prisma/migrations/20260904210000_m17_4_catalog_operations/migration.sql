CREATE TABLE "ReleaseLifecycleRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "trackId" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'RELEASE',
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "summary" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "requestedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseLifecycleRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReleaseLifecycleRequest_shop_releaseId_status_updatedAt_idx"
ON "ReleaseLifecycleRequest"("shop", "releaseId", "status", "updatedAt");

CREATE INDEX "ReleaseLifecycleRequest_releaseId_createdAt_idx"
ON "ReleaseLifecycleRequest"("releaseId", "createdAt");

CREATE INDEX "ReleaseLifecycleRequest_trackId_idx"
ON "ReleaseLifecycleRequest"("trackId");

CREATE INDEX "ReleaseLifecycleRequest_shop_type_status_updatedAt_idx"
ON "ReleaseLifecycleRequest"("shop", "type", "status", "updatedAt");

ALTER TABLE "ReleaseLifecycleRequest"
ADD CONSTRAINT "ReleaseLifecycleRequest_releaseId_fkey"
FOREIGN KEY ("releaseId") REFERENCES "Release"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReleaseLifecycleRequest"
ADD CONSTRAINT "ReleaseLifecycleRequest_trackId_fkey"
FOREIGN KEY ("trackId") REFERENCES "Track"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
