CREATE TABLE "ProductionMutation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "deploymentProfile" TEXT NOT NULL DEFAULT 'releasecore',
    "requestId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionMutation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionMutation_shop_deploymentProfile_requestId_key"
ON "ProductionMutation"("shop", "deploymentProfile", "requestId");

CREATE INDEX "ProductionMutation_shop_deploymentProfile_createdAt_idx"
ON "ProductionMutation"("shop", "deploymentProfile", "createdAt");

CREATE INDEX "ProductionMutation_shop_operation_createdAt_idx"
ON "ProductionMutation"("shop", "operation", "createdAt");
