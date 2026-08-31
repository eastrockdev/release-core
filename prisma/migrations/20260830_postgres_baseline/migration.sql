-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled Release',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "distributionStatus" TEXT NOT NULL DEFAULT 'NOT_QUEUED',
    "distributionUpdatedAt" TIMESTAMP(3),
    "aggregatorReference" TEXT,
    "distributionNotes" TEXT,
    "upc" TEXT,
    "upcAssignedAt" TIMESTAMP(3),
    "catalogNumber" TEXT,
    "catalogNumberAssignedAt" TIMESTAMP(3),
    "ownerCustomerId" TEXT,
    "shopifyReleaseProductId" TEXT,
    "shopifyReleaseProductHandle" TEXT,
    "artistName" TEXT,
    "primaryGenre" TEXT,
    "releaseDate" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "lastSubmittedAt" TIMESTAMP(3),
    "reviewStartedAt" TIMESTAMP(3),
    "decisionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled Track',
    "version" TEXT,
    "language" TEXT,
    "explicit" BOOLEAN NOT NULL DEFAULT false,
    "isrc" TEXT,
    "isrcAssignedAt" TIMESTAMP(3),
    "shopifyProductId" TEXT,
    "shopifyProductHandle" TEXT,
    "lyrics" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "email" TEXT,
    "spotifyUrl" TEXT,
    "appleMusicUrl" TEXT,
    "websiteUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseArtist" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PRIMARY',
    "position" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseArtist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackArtist" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PRIMARY',
    "position" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackArtist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalArtistAccess" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalArtistAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalCustomerPolicy" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "artistMode" TEXT NOT NULL DEFAULT 'MULTI',
    "soloArtistId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalCustomerPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contributor" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "ownerCustomerId" TEXT,
    "legalName" TEXT NOT NULL,
    "stageName" TEXT,
    "email" TEXT,
    "pro" TEXT,
    "ipi" TEXT,
    "publisherName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackCredit" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ownershipPercent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseFile" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "trackId" TEXT,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'SHOPIFY_FILES',
    "storageKey" TEXT,
    "url" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionEvent" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "actorLabel" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "trackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerId" TEXT,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseReviewItem" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "trackId" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReleaseReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "countryCode" TEXT,
    "registrantCode" TEXT,
    "autoAssignIsrc" BOOLEAN NOT NULL DEFAULT true,
    "defaultLabelName" TEXT,
    "defaultCopyrightHolder" TEXT,
    "defaultGenre" TEXT,
    "defaultLanguage" TEXT,
    "requireLyrics" BOOLEAN NOT NULL DEFAULT true,
    "requirePublishing" BOOLEAN NOT NULL DEFAULT true,
    "requireSplitSheet" BOOLEAN NOT NULL DEFAULT false,
    "requireCredits" BOOLEAN NOT NULL DEFAULT false,
    "requireIsrc" BOOLEAN NOT NULL DEFAULT true,
    "requireTrackLanguage" BOOLEAN NOT NULL DEFAULT true,
    "releaseLeadTimeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "releaseLeadTimeDays" INTEGER NOT NULL DEFAULT 14,
    "upcMode" TEXT NOT NULL DEFAULT 'AGGREGATOR',
    "gs1CompanyPrefix" TEXT,
    "catalogMode" TEXT NOT NULL DEFAULT 'AUTO',
    "catalogPrefix" TEXT,
    "catalogIncludeYear" BOOLEAN NOT NULL DEFAULT true,
    "catalogSequenceWidth" INTEGER NOT NULL DEFAULT 4,
    "autoAssignCatalogNumber" BOOLEAN NOT NULL DEFAULT true,
    "defaultTrackPrice" DOUBLE PRECISION NOT NULL DEFAULT 1.29,
    "generateShopifyAudioPreview" BOOLEAN NOT NULL DEFAULT false,
    "audioPreviewDurationSeconds" INTEGER NOT NULL DEFAULT 60,
    "audioPreviewBitrateKbps" INTEGER NOT NULL DEFAULT 192,
    "releaseSingleEnabled" BOOLEAN NOT NULL DEFAULT true,
    "releaseSingleRequiredTags" TEXT,
    "releaseEpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "releaseEpRequiredTags" TEXT,
    "releaseAlbumEnabled" BOOLEAN NOT NULL DEFAULT true,
    "releaseAlbumRequiredTags" TEXT,
    "releaseTagMatchMode" TEXT NOT NULL DEFAULT 'ANY',
    "releaseAccessLockMessage" TEXT,
    "artistEmailEvents" TEXT NOT NULL DEFAULT 'SUBMITTED,CHANGES_REQUESTED,APPROVED,REJECTED,SUBMITTED_TO_STORES,DELIVERED',
    "adminEmailEvents" TEXT NOT NULL DEFAULT 'SUBMITTED,CHANGES_REQUESTED,APPROVED,REJECTED',
    "flowEvents" TEXT NOT NULL DEFAULT 'SUBMITTED,CHANGES_REQUESTED,APPROVED,REJECTED,PROCESSING,SUBMITTED_TO_STORES,DELIVERED,SHOPIFY_PRODUCTS_SYNCED',
    "smtpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smtpHost" TEXT,
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpSecurity" TEXT NOT NULL DEFAULT 'STARTTLS',
    "smtpUsername" TEXT,
    "smtpPasswordEncrypted" TEXT,
    "emailSenderName" TEXT,
    "emailFromAddress" TEXT,
    "emailReplyTo" TEXT,
    "adminNotificationEmail" TEXT,
    "emailBrandName" TEXT,
    "emailFooterText" TEXT,
    "portalUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IsrcSequence" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "registrantCode" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextDesignation" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IsrcSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpcSequence" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "companyPrefix" TEXT NOT NULL,
    "nextItemReference" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpcSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSequence" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "yearKey" INTEGER NOT NULL,
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Release_upc_key" ON "Release"("upc");

-- CreateIndex
CREATE UNIQUE INDEX "Release_shopifyReleaseProductId_key" ON "Release"("shopifyReleaseProductId");

-- CreateIndex
CREATE INDEX "Release_shop_status_idx" ON "Release"("shop", "status");

-- CreateIndex
CREATE INDEX "Release_shop_distributionStatus_idx" ON "Release"("shop", "distributionStatus");

-- CreateIndex
CREATE INDEX "Release_shop_ownerCustomerId_idx" ON "Release"("shop", "ownerCustomerId");

-- CreateIndex
CREATE INDEX "Release_shop_createdAt_idx" ON "Release"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Release_shop_catalogNumber_key" ON "Release"("shop", "catalogNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Track_isrc_key" ON "Track"("isrc");

-- CreateIndex
CREATE UNIQUE INDEX "Track_shopifyProductId_key" ON "Track"("shopifyProductId");

-- CreateIndex
CREATE INDEX "Track_releaseId_idx" ON "Track"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Track_releaseId_position_key" ON "Track"("releaseId", "position");

-- CreateIndex
CREATE INDEX "Artist_shop_name_idx" ON "Artist"("shop", "name");

-- CreateIndex
CREATE INDEX "ReleaseArtist_releaseId_position_idx" ON "ReleaseArtist"("releaseId", "position");

-- CreateIndex
CREATE INDEX "ReleaseArtist_artistId_idx" ON "ReleaseArtist"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseArtist_releaseId_artistId_role_key" ON "ReleaseArtist"("releaseId", "artistId", "role");

-- CreateIndex
CREATE INDEX "TrackArtist_trackId_position_idx" ON "TrackArtist"("trackId", "position");

-- CreateIndex
CREATE INDEX "TrackArtist_artistId_idx" ON "TrackArtist"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackArtist_trackId_artistId_role_key" ON "TrackArtist"("trackId", "artistId", "role");

-- CreateIndex
CREATE INDEX "PortalArtistAccess_shop_customerId_idx" ON "PortalArtistAccess"("shop", "customerId");

-- CreateIndex
CREATE INDEX "PortalArtistAccess_artistId_idx" ON "PortalArtistAccess"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalArtistAccess_shop_customerId_artistId_key" ON "PortalArtistAccess"("shop", "customerId", "artistId");

-- CreateIndex
CREATE INDEX "PortalCustomerPolicy_soloArtistId_idx" ON "PortalCustomerPolicy"("soloArtistId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalCustomerPolicy_shop_customerId_key" ON "PortalCustomerPolicy"("shop", "customerId");

-- CreateIndex
CREATE INDEX "Contributor_shop_legalName_idx" ON "Contributor"("shop", "legalName");

-- CreateIndex
CREATE INDEX "Contributor_shop_ownerCustomerId_idx" ON "Contributor"("shop", "ownerCustomerId");

-- CreateIndex
CREATE INDEX "TrackCredit_trackId_idx" ON "TrackCredit"("trackId");

-- CreateIndex
CREATE INDEX "TrackCredit_contributorId_idx" ON "TrackCredit"("contributorId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackCredit_trackId_contributorId_role_key" ON "TrackCredit"("trackId", "contributorId", "role");

-- CreateIndex
CREATE INDEX "ReleaseFile_releaseId_idx" ON "ReleaseFile"("releaseId");

-- CreateIndex
CREATE INDEX "ReleaseFile_trackId_idx" ON "ReleaseFile"("trackId");

-- CreateIndex
CREATE INDEX "SubmissionEvent_releaseId_createdAt_idx" ON "SubmissionEvent"("releaseId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_shop_createdAt_idx" ON "NotificationDelivery"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_releaseId_createdAt_idx" ON "NotificationDelivery"("releaseId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_idx" ON "NotificationDelivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_eventId_channel_key" ON "NotificationDelivery"("eventId", "channel");

-- CreateIndex
CREATE INDEX "ReleaseReviewItem_releaseId_status_idx" ON "ReleaseReviewItem"("releaseId", "status");

-- CreateIndex
CREATE INDEX "ReleaseReviewItem_trackId_idx" ON "ReleaseReviewItem"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_shop_key" ON "AppSettings"("shop");

-- CreateIndex
CREATE INDEX "IsrcSequence_shop_year_idx" ON "IsrcSequence"("shop", "year");

-- CreateIndex
CREATE UNIQUE INDEX "IsrcSequence_shop_countryCode_registrantCode_year_key" ON "IsrcSequence"("shop", "countryCode", "registrantCode", "year");

-- CreateIndex
CREATE INDEX "UpcSequence_shop_idx" ON "UpcSequence"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "UpcSequence_shop_companyPrefix_key" ON "UpcSequence"("shop", "companyPrefix");

-- CreateIndex
CREATE INDEX "CatalogSequence_shop_yearKey_idx" ON "CatalogSequence"("shop", "yearKey");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogSequence_shop_prefix_yearKey_key" ON "CatalogSequence"("shop", "prefix", "yearKey");

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseArtist" ADD CONSTRAINT "ReleaseArtist_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseArtist" ADD CONSTRAINT "ReleaseArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackArtist" ADD CONSTRAINT "TrackArtist_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackArtist" ADD CONSTRAINT "TrackArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalArtistAccess" ADD CONSTRAINT "PortalArtistAccess_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalCustomerPolicy" ADD CONSTRAINT "PortalCustomerPolicy_soloArtistId_fkey" FOREIGN KEY ("soloArtistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackCredit" ADD CONSTRAINT "TrackCredit_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackCredit" ADD CONSTRAINT "TrackCredit_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "Contributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseFile" ADD CONSTRAINT "ReleaseFile_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseFile" ADD CONSTRAINT "ReleaseFile_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionEvent" ADD CONSTRAINT "SubmissionEvent_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SubmissionEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseReviewItem" ADD CONSTRAINT "ReleaseReviewItem_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseReviewItem" ADD CONSTRAINT "ReleaseReviewItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;

