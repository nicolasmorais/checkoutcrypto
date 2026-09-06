-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "trackingCarrier" TEXT,
ADD COLUMN     "trackingNumber" TEXT,
ADD COLUMN     "trackingSentAt" TIMESTAMP(3),
ADD COLUMN     "trackingUrl" TEXT;
