-- ReleaseCore M18.0
-- Publisher identity belongs to the ReleaseCore Artist record rather than the
-- legacy Shopify customer profile.
ALTER TABLE "Artist"
  ADD COLUMN "publisherName" TEXT,
  ADD COLUMN "publisherIpi" TEXT;
