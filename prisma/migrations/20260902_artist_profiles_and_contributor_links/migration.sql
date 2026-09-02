-- AlterTable
ALTER TABLE "Artist"
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "imageFileId" TEXT,
ADD COLUMN "biography" TEXT,
ADD COLUMN "pro" TEXT,
ADD COLUMN "ipi" TEXT,
ADD COLUMN "instagramUrl" TEXT,
ADD COLUMN "facebookUrl" TEXT,
ADD COLUMN "tiktokUrl" TEXT,
ADD COLUMN "youtubeUrl" TEXT,
ADD COLUMN "xUrl" TEXT;

-- CreateTable
CREATE TABLE "ArtistContributor" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistContributor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtistContributor_artistId_contributorId_key" ON "ArtistContributor"("artistId", "contributorId");
CREATE INDEX "ArtistContributor_artistId_idx" ON "ArtistContributor"("artistId");
CREATE INDEX "ArtistContributor_contributorId_idx" ON "ArtistContributor"("contributorId");

-- AddForeignKey
ALTER TABLE "ArtistContributor" ADD CONSTRAINT "ArtistContributor_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistContributor" ADD CONSTRAINT "ArtistContributor_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "Contributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
