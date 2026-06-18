const { prisma } = require('./db');

async function run() {
    try {
        const settings = await prisma.saasSettings.findFirst();
        console.log('--- SAAS SETTINGS ---');
        console.dir(settings, { depth: null });
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
