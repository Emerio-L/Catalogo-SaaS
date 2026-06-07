const { prisma } = require('./db');

async function run() {
    try {
        const payments = await prisma.payment.findMany({
            include: {
                tenant: true
            }
        });
        console.log('--- ALL PAYMENTS ---');
        console.dir(payments, { depth: null });
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
