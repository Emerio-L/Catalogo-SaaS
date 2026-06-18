const bcrypt = require('bcryptjs');
const { prisma } = require('./db');

async function main() {
    const user = await prisma.user.findFirst({
        where: { usuario: 'testuser_multi' }
    });
    if (!user) {
        console.error('User testuser_multi not found');
        return;
    }
    const hash = await bcrypt.hash('Test1234', 12);
    await prisma.user.update({
        where: { id: user.id },
        data: {
            passwordHash: hash,
            mustChangePassword: false,
            mustChangeUsername: false
        }
    });
    console.log('Password for testuser_multi updated to Test1234');
    await prisma.$disconnect();
}

main().catch(console.error);
