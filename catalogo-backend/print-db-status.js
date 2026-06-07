const { prisma } = require('./db');

async function run() {
    try {
        console.log('--- TENANTS ---');
        const tenants = await prisma.tenant.findMany({
            include: {
                users: true,
                settings: true
            }
        });
        console.dir(tenants, { depth: null });

        console.log('\n--- SESSIONS ---');
        const sessions = await prisma.session.findMany();
        console.dir(sessions, { depth: null });

        console.log('\n--- ORDERS ---');
        const orders = await prisma.order.findMany({
            include: {
                productos: true
            }
        });
        console.dir(orders, { depth: null });
        
        console.log('\n--- PLANS ---');
        const plans = await prisma.plan.findMany();
        console.dir(plans, { depth: null });
    } catch (err) {
        console.error('Error printing DB status:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
