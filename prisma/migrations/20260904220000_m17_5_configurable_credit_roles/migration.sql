-- ReleaseCore M17.5
-- Merchants can append non-core contributor credit roles without changing
-- the stable built-in publishing semantics for SONGWRITER / COMPOSER.
ALTER TABLE "AppSettings"
  ADD COLUMN "additionalCreditRoles" TEXT;
