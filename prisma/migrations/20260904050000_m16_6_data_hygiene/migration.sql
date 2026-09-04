ALTER TABLE "ArtistContributor"
ADD COLUMN "relationshipType" TEXT NOT NULL DEFAULT 'REGULAR';

CREATE TABLE "DataMaintenanceEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "deploymentProfile" TEXT NOT NULL DEFAULT 'releasecore',
    "operation" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "sourceId" TEXT,
    "targetId" TEXT,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataMaintenanceEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataMaintenanceEvent_shop_deploymentProfile_createdAt_idx"
ON "DataMaintenanceEvent"("shop", "deploymentProfile", "createdAt");

CREATE INDEX "DataMaintenanceEvent_shop_operation_createdAt_idx"
ON "DataMaintenanceEvent"("shop", "operation", "createdAt");
