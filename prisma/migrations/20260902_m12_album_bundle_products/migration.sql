-- M12.2: release-level Album/EP Shopify products and fixed bundle recovery.
ALTER TABLE "Release"
  ADD COLUMN "shopifyReleaseBundleOperationId" TEXT;

ALTER TABLE "AppSettings"
  ADD COLUMN "defaultAlbumPrice" DOUBLE PRECISION NOT NULL DEFAULT 9.99,
  ADD COLUMN "shopifyAlbumProductDefaultState" TEXT NOT NULL DEFAULT 'DRAFT';
