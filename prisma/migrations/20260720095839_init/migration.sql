-- CreateEnum
CREATE TYPE "ImageStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "Image" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedFilename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "ImageStatus" NOT NULL DEFAULT 'pending',
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sha256Hash" TEXT NOT NULL,
    "perceptualHash" TEXT,
    "analysisResult" JSONB,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStartedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Image_status_idx" ON "Image"("status");

-- CreateIndex
CREATE INDEX "Image_sha256Hash_idx" ON "Image"("sha256Hash");

-- CreateIndex
CREATE INDEX "Image_perceptualHash_idx" ON "Image"("perceptualHash");
