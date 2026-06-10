const { prisma } = require('./db');
const bcrypt = require('bcryptjs');

async function run() {
    try {
        const username = (process.env.SUPER_ADMIN_USER || '').toLowerCase().trim();
        const newPassword = process.env.SUPER_ADMIN_PASSWORD || '';
        if (!username || !newPassword) {
            throw new Error('Define SUPER_ADMIN_USER y SUPER_ADMIN_PASSWORD antes de ejecutar este script.');
        }
        const salt = await bcrypt.genSalt(12);
        const hash = await bcrypt.hash(newPassword, salt);

        const updated = await prisma.user.updateMany({
            where: { usuario: username, rol: 'super_admin' },
            data: { passwordHash: hash }
        });

        console.log(`Updated ${updated.count} super_admin user(s).`);
    } catch (err) {
        console.error('Error updating password:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
