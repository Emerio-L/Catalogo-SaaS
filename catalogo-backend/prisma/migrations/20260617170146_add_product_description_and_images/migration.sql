/*
  Warnings:

  - You are about to drop the `PaymentDetails` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "PaymentDetails" DROP CONSTRAINT "PaymentDetails_tenantId_fkey";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "descripcion" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "imagenes" JSONB;

-- DropTable
DROP TABLE "PaymentDetails";
