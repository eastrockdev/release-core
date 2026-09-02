ALTER TABLE "AppSettings"
  ADD COLUMN "lockArtistNameEditing" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lockContributorIdentityAfterSubmission" BOOLEAN NOT NULL DEFAULT true;
