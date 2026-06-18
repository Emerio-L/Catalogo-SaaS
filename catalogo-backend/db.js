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
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AccountNumberSequence" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "value" INTEGER NOT NULL DEFAULT 0,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await prisma.$executeRawUnsafe(`
        INSERT INTO "AccountNumberSequence" ("id", "value", "updatedAt")
        SELECT
            'tenant',
            COALESCE(MAX(SUBSTRING("accountNumber" FROM '^CT-([0-9]+)$')::INTEGER), 0),
            CURRENT_TIMESTAMP
        FROM "Tenant"
        WHERE "accountNumber" ~ '^CT-[0-9]+$'
        ON CONFLICT ("id") DO NOTHING
    `);
}

module.exports = {
    prisma,
    ensureRuntimeSchemaCompatibility
};

