ALTER TABLE "AppSettings"
ADD COLUMN "isrcMode" TEXT NOT NULL DEFAULT 'AUTO';

UPDATE "AppSettings"
SET "isrcMode" = 'ADMIN'
WHERE "autoAssignIsrc" = false;
