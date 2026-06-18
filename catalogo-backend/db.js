const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function ensureRuntimeSchemaCompatibility() {
    await prisma.$executeRawUnsafe(`
        ALTER TABLE "Tenant"
        ADD COLUMN IF NOT EXISTS "paymentConfig" JSONB
    `);
    await prisma.$executeRawUnsafe(`
        ALTER TABLE "SaasSettings"
        ADD COLUMN IF NOT EXISTS "paymentBankName" TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "paymentBankAccount" TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "paymentBankAccountType" TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "paymentBankAccountName" TEXT NOT NULL DEFAULT ''
    `);
    await prisma.$executeRawUnsafe(`
        ALTER TABLE "Product"
        ADD COLUMN IF NOT EXISTS "descripcion" TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "imagenes" JSONB
    `);
    await prisma.$executeRawUnsafe(`
        ALTER TABLE "Payment"
        ADD COLUMN IF NOT EXISTS "receiptPublicId" TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "receiptResourceType" TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "receiptOriginalName" TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "receiptMimeType" TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "receiptSizeBytes" INTEGER NOT NULL DEFAULT 0
    `);
}

module.exports = {
    prisma,
    ensureRuntimeSchemaCompatibility
};

