-- M12.1 Shopify catalog foundations
ALTER TABLE "Release" ADD COLUMN "preSaveUrl" TEXT;
ALTER TABLE "Release" ADD COLUMN "streamingUrl" TEXT;

ALTER TABLE "AppSettings" ADD COLUMN "shopifyTrackProductDefaultState" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "AppSettings" ADD COLUMN "shopifySingleTemplateSuffix" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "shopifyAlbumTemplateSuffix" TEXT;
