-- ReleaseCore M13.0.4: digital purchase entitlements + private MP3/FLAC derivatives

ALTER TABLE "AppSettings"
  ADD COLUMN "customerDownloadsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "customerDownloadAutoGenerate" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "customerDownloadMp3Enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "customerDownloadMp3BitrateKbps" INTEGER NOT NULL DEFAULT 320,
  ADD COLUMN "customerDownloadFlacEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "customerDownloadFlacCompressionLevel" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "customerDownloadEmbedArtwork" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "customerDownloadEmbedLyrics" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "customerDownloadEmbedCredits" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "customerDownloadEmbedArtistLinks" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "ReleaseFile"
  ADD COLUMN "derivativeFingerprint" TEXT;

CREATE INDEX "ReleaseFile_trackId_kind_idx"
  ON "ReleaseFile"("trackId", "kind");

CREATE TABLE "CommerceOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderGid" TEXT,
    "orderName" TEXT,
    "customerId" TEXT,
    "currency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceEntitlement" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "commerceOrderId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "salesLineItemGroupId" TEXT,
    "customerId" TEXT,
    "trackId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "sourceProductId" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'TRACK',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "refundedQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceDownload" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "customerId" TEXT,
    "format" TEXT,
    "releaseFileId" TEXT,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceDownload_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceWebhookEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommerceOrder_shop_shopifyOrderId_key"
ON "CommerceOrder"("shop", "shopifyOrderId");

CREATE INDEX "CommerceOrder_shop_customerId_idx"
ON "CommerceOrder"("shop", "customerId");

CREATE INDEX "CommerceOrder_shop_createdAt_idx"
ON "CommerceOrder"("shop", "createdAt");

CREATE UNIQUE INDEX "CommerceEntitlement_shop_shopifyOrderId_shopifyLineItemId_trackId_key"
ON "CommerceEntitlement"("shop", "shopifyOrderId", "shopifyLineItemId", "trackId");

CREATE INDEX "CommerceEntitlement_shop_customerId_status_idx"
ON "CommerceEntitlement"("shop", "customerId", "status");

CREATE INDEX "CommerceEntitlement_shop_shopifyOrderId_status_idx"
ON "CommerceEntitlement"("shop", "shopifyOrderId", "status");

CREATE INDEX "CommerceEntitlement_shop_trackId_idx"
ON "CommerceEntitlement"("shop", "trackId");

CREATE INDEX "CommerceDownload_shop_entitlementId_idx"
ON "CommerceDownload"("shop", "entitlementId");

CREATE INDEX "CommerceDownload_shop_customerId_idx"
ON "CommerceDownload"("shop", "customerId");

CREATE UNIQUE INDEX "CommerceWebhookEvent_shop_topic_resourceId_key"
ON "CommerceWebhookEvent"("shop", "topic", "resourceId");

ALTER TABLE "CommerceEntitlement"
ADD CONSTRAINT "CommerceEntitlement_commerceOrderId_fkey"
FOREIGN KEY ("commerceOrderId") REFERENCES "CommerceOrder"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceDownload"
ADD CONSTRAINT "CommerceDownload_entitlementId_fkey"
FOREIGN KEY ("entitlementId") REFERENCES "CommerceEntitlement"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
