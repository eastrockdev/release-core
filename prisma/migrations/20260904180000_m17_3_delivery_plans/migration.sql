CREATE TABLE "ReleaseDeliveryPlan" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "channelMode" TEXT NOT NULL DEFAULT 'ALL',
    "channelKeys" JSONB NOT NULL DEFAULT '[]',
    "territoryMode" TEXT NOT NULL DEFAULT 'WORLDWIDE',
    "territoryCodes" JSONB NOT NULL DEFAULT '[]',
    "exclusiveChannelKey" TEXT,
    "exclusiveStartDate" TIMESTAMP(3),
    "exclusiveEndDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseDeliveryPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReleaseDeliveryChannel" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "channelKey" TEXT NOT NULL,
    "enabledState" TEXT NOT NULL DEFAULT 'INHERIT',
    "releaseDate" TIMESTAMP(3),
    "territoryMode" TEXT NOT NULL DEFAULT 'INHERIT',
    "territoryCodes" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseDeliveryChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReleaseDeliveryPlan_releaseId_key"
ON "ReleaseDeliveryPlan"("releaseId");

CREATE INDEX "ReleaseDeliveryPlan_shop_updatedAt_idx"
ON "ReleaseDeliveryPlan"("shop", "updatedAt");

CREATE UNIQUE INDEX "ReleaseDeliveryChannel_planId_channelKey_key"
ON "ReleaseDeliveryChannel"("planId", "channelKey");

CREATE INDEX "ReleaseDeliveryChannel_shop_updatedAt_idx"
ON "ReleaseDeliveryChannel"("shop", "updatedAt");

CREATE INDEX "ReleaseDeliveryChannel_planId_idx"
ON "ReleaseDeliveryChannel"("planId");

ALTER TABLE "ReleaseDeliveryPlan"
ADD CONSTRAINT "ReleaseDeliveryPlan_releaseId_fkey"
FOREIGN KEY ("releaseId") REFERENCES "Release"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReleaseDeliveryChannel"
ADD CONSTRAINT "ReleaseDeliveryChannel_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "ReleaseDeliveryPlan"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
