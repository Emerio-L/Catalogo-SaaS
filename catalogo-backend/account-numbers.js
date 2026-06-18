function formatAccountNumber(sequence) {
    return `CT-${String(sequence).padStart(6, '0')}`;
}

async function ensureAccountNumberSequence(prisma) {
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

async function nextAccountNumber(prisma) {
    await ensureAccountNumberSequence(prisma);
    const rows = await prisma.$queryRawUnsafe(`
        WITH existing_max AS (
            SELECT COALESCE(MAX(SUBSTRING("accountNumber" FROM '^CT-([0-9]+)$')::INTEGER), 0) AS max_value
            FROM "Tenant"
            WHERE "accountNumber" ~ '^CT-[0-9]+$'
        ),
        updated AS (
            INSERT INTO "AccountNumberSequence" ("id", "value", "updatedAt")
            SELECT 'tenant', max_value + 1, CURRENT_TIMESTAMP
            FROM existing_max
            ON CONFLICT ("id") DO UPDATE SET
                "value" = GREATEST("AccountNumberSequence"."value", (SELECT max_value FROM existing_max)) + 1,
                "updatedAt" = CURRENT_TIMESTAMP
            RETURNING "value"
        )
        SELECT "value" FROM updated
    `);
    const nextSequence = Number(rows?.[0]?.value || 0);
    if (!Number.isInteger(nextSequence) || nextSequence <= 0) {
        throw new Error('No se pudo generar un numero de cuenta unico.');
    }
    return formatAccountNumber(nextSequence);
}

async function createTenantWithAccountNumber(prisma, data) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await prisma.tenant.create({
                data: {
                    ...data,
                    accountNumber: await nextAccountNumber(prisma)
                }
            });
        } catch (error) {
            if (error?.code !== 'P2002' || !String(error?.meta?.target || '').includes('accountNumber')) {
                throw error;
            }
        }
    }
    throw new Error('No se pudo generar un numero de cuenta unico.');
}

module.exports = {
    createTenantWithAccountNumber,
    ensureAccountNumberSequence,
    formatAccountNumber,
    nextAccountNumber
};
