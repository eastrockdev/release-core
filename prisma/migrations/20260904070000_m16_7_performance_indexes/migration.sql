CREATE INDEX "Release_shop_updatedAt_idx"
ON "Release"("shop", "updatedAt");

CREATE INDEX "Release_shop_lastSubmittedAt_idx"
ON "Release"("shop", "lastSubmittedAt");

CREATE INDEX "Release_shop_distributionUpdatedAt_idx"
ON "Release"("shop", "distributionUpdatedAt");
