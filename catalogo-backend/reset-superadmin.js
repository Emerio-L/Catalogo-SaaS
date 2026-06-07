const { prisma } = require('./db');
const bcrypt = require('bcryptjs');

async function run() {
    try {
        const username = 'superadmin';
        const newPassword = 'Super-Admin-2026!';
        const salt = await bcrypt.genSalt(12);
        const hash = await bcrypt.hash(newPassword, salt);

        const updated = await prisma.user.updateMany({
            where: { usuario: username, rol: 'super_admin' },
            data: { passwordHash: hash }
        });

        console.log(`Updated ${updated.count} super_admin user(s) with password "${newPassword}"`);
    } catch (err) {
        console.error('Error updating password:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
