-- ReleaseCore Resend API v1.0.0
-- Preserve Custom SMTP as the existing default and add an HTTPS API transport.

ALTER TABLE "AppSettings"
ADD COLUMN "emailDeliveryProvider" TEXT NOT NULL DEFAULT 'SMTP',
ADD COLUMN "resendApiKeyEncrypted" TEXT;
