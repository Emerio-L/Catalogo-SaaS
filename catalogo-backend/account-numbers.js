function formatAccountNumber(sequence) {
    return `CT-${String(sequence).padStart(6, '0')}`;
}

async function nextAccountNumber(prisma) {
    const latest = await prisma.tenant.findFirst({
        where: { accountNumber: { startsWith: 'CT-' } },
        orderBy: { accountNumber: 'desc' },
        select: { accountNumber: true }
    });
    const current = Number(/^CT-(\d{6})$/.exec(latest?.accountNumber || '')?.[1] || 0);
    return formatAccountNumber(current + 1);
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
    formatAccountNumber,
    nextAccountNumber
};
