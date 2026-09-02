CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shopifyRequestId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrivacyRequest_shop_topic_shopifyRequestId_key" ON "PrivacyRequest"("shop", "topic", "shopifyRequestId");
CREATE INDEX "PrivacyRequest_shop_status_requestedAt_idx" ON "PrivacyRequest"("shop", "status", "requestedAt");
CREATE INDEX "PrivacyRequest_shop_customerId_idx" ON "PrivacyRequest"("shop", "customerId");
