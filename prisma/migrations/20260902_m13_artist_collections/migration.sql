-- ReleaseCore M12.3.3: Artist -> Shopify Collection publishing

ALTER TABLE "Artist"
  ADD COLUMN "shopifyCollectionId" TEXT,
  ADD COLUMN "shopifyCollectionHandle" TEXT,
  ADD COLUMN "shopifyCollectionSourceId" TEXT,
  ADD COLUMN "shopifyCollectionSyncedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Artist_shopifyCollectionId_key"
  ON "Artist"("shopifyCollectionId");

ALTER TABLE "AppSettings"
  ADD COLUMN "shopifyArtistCollectionTemplateSuffix" TEXT;
