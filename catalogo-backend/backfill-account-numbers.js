require('dotenv').config();
const { prisma } = require('./db');

async function main() {
    const tenants = await prisma.tenant.findMany({
        orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
        select: { id: true, accountNumber: true }
    });

    const usedNumbers = new Set(
        tenants
            .map(tenant => tenant.accountNumber)
            .filter(Boolean)
    );
    let nextSequence = tenants.reduce((max, tenant) => {
        const match = /^CT-(\d{6})$/.exec(tenant.accountNumber || '');
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;

    for (const tenant of tenants) {
        if (tenant.accountNumber) continue;
        let accountNumber;
        do {
            accountNumber = `CT-${String(nextSequence++).padStart(6, '0')}`;
        } while (usedNumbers.has(accountNumber));

        await prisma.tenant.update({
            where: { id: tenant.id },
            data: { accountNumber }
        });
        usedNumbers.add(accountNumber);
        console.log(`${tenant.id}: ${accountNumber}`);
    }
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
