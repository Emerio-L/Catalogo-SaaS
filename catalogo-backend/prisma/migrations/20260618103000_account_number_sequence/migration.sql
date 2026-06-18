CREATE TABLE IF NOT EXISTS "AccountNumberSequence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "AccountNumberSequence" ("id", "value", "updatedAt")
SELECT
    'tenant',
    COALESCE(MAX(SUBSTRING("accountNumber" FROM '^CT-([0-9]+)$')::INTEGER), 0),
    CURRENT_TIMESTAMP
FROM "Tenant"
WHERE "accountNumber" ~ '^CT-[0-9]+$'
ON CONFLICT ("id") DO NOTHING;
