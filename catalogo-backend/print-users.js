const { prisma } = require('./db');

async function run() {
    try {
        const users = await prisma.user.findMany();
        console.log('--- ALL USERS ---');
        console.dir(users, { depth: null });
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
