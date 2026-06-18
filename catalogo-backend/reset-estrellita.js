const { prisma } = require('./db');
const bcrypt = require('bcryptjs');

async function run() {
    try {
        const salt = await bcrypt.genSalt(12);
        const hash = await bcrypt.hash('estrellita123', salt);

        const updated = await prisma.user.updateMany({
            where: { usuario: 'estrellita' },
            data: { passwordHash: hash }
        });

        console.log(`Updated ${updated.count} user(s).`);
    } catch (err) {
        console.error('Error updating password:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
