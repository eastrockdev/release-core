CREATE TABLE "ReleaseRelationship" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "relatedReleaseId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseRelationship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackRelationship" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "releaseRelationshipId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "relatedTrackId" TEXT NOT NULL,
    "recordingRelationship" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackRelationship_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReleaseRelationship_shop_releaseId_relatedReleaseId_key"
ON "ReleaseRelationship"("shop", "releaseId", "relatedReleaseId");

CREATE INDEX "ReleaseRelationship_shop_releaseId_updatedAt_idx"
ON "ReleaseRelationship"("shop", "releaseId", "updatedAt");

CREATE INDEX "ReleaseRelationship_shop_relatedReleaseId_updatedAt_idx"
ON "ReleaseRelationship"("shop", "relatedReleaseId", "updatedAt");

CREATE UNIQUE INDEX "TrackRelationship_releaseRelationshipId_trackId_key"
ON "TrackRelationship"("releaseRelationshipId", "trackId");

CREATE INDEX "TrackRelationship_shop_trackId_idx"
ON "TrackRelationship"("shop", "trackId");

CREATE INDEX "TrackRelationship_shop_relatedTrackId_idx"
ON "TrackRelationship"("shop", "relatedTrackId");

ALTER TABLE "ReleaseRelationship"
ADD CONSTRAINT "ReleaseRelationship_releaseId_fkey"
FOREIGN KEY ("releaseId") REFERENCES "Release"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReleaseRelationship"
ADD CONSTRAINT "ReleaseRelationship_relatedReleaseId_fkey"
FOREIGN KEY ("relatedReleaseId") REFERENCES "Release"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrackRelationship"
ADD CONSTRAINT "TrackRelationship_releaseRelationshipId_fkey"
FOREIGN KEY ("releaseRelationshipId") REFERENCES "ReleaseRelationship"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrackRelationship"
ADD CONSTRAINT "TrackRelationship_trackId_fkey"
FOREIGN KEY ("trackId") REFERENCES "Track"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrackRelationship"
ADD CONSTRAINT "TrackRelationship_relatedTrackId_fkey"
FOREIGN KEY ("relatedTrackId") REFERENCES "Track"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
