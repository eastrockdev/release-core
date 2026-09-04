ALTER TABLE "PortalCustomerPolicy"
ADD COLUMN "releaseCreationDisabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "releaseCreationDisabledReason" TEXT;
