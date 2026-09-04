-- ReleaseCore M18.3 — Users & Labels / label-owned distribution identity

ALTER TABLE "Release"
  ADD COLUMN "labelName" TEXT,
  ADD COLUMN "pLineHolder" TEXT;

ALTER TABLE "AppSettings"
  ADD COLUMN "portalLabelPlans" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE "PortalLabelAccount" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "name" TEXT,
  "sourceTag" TEXT,
  "artistLimit" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortalLabelAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortalLabelAccount_shop_customerId_key"
  ON "PortalLabelAccount"("shop", "customerId");

CREATE INDEX "PortalLabelAccount_shop_updatedAt_idx"
  ON "PortalLabelAccount"("shop", "updatedAt");
