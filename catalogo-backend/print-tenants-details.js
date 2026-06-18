const { prisma } = require('./db');

async function run() {
    try {
        const tenants = await prisma.tenant.findMany({
            select: {
                id: true,
                slug: true,
                adminAccessKey: true,
                nombre: true,
                users: {
                    select: {
                        usuario: true,
                        email: true,
                        rol: true
                    }
                }
            }
        });
        console.log('--- DETAILED TENANTS & USERS ---');
        console.dir(tenants, { depth: null });
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
