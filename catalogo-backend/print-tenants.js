const { prisma } = require('./db');

async function run() {
    try {
        const tenants = await prisma.tenant.findMany({
            select: {
                slug: true,
                adminAccessKey: true,
                nombre: true
            }
        });
        console.log('--- ALL TENANTS ---');
        console.dir(tenants, { depth: null });
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
