CREATE TABLE "ReleaseTemplate" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceReleaseId" TEXT,
    "releaseType" TEXT NOT NULL,
    "trackCount" INTEGER NOT NULL DEFAULT 1,
    "blueprint" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReleaseTemplate_shop_name_key"
ON "ReleaseTemplate"("shop", "name");

CREATE INDEX "ReleaseTemplate_shop_updatedAt_idx"
ON "ReleaseTemplate"("shop", "updatedAt");

CREATE INDEX "ReleaseTemplate_shop_releaseType_idx"
ON "ReleaseTemplate"("shop", "releaseType");
