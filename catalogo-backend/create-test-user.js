const bcrypt = require('bcryptjs');
const { prisma } = require('./db');

async function main() {
    const tenant = await prisma.tenant.findFirst({ where: { slug: 'superpan' } });
    console.log('Tenant:', tenant.id, tenant.slug);
    const hash = await bcrypt.hash('Test1234', 12);
    await prisma.user.create({
        data: {
            tenantId: tenant.id,
            nombre: 'Test User',
            email: 'test@test.com',
            usuario: 'testadmin',
            passwordHash: hash,
            rol: 'tenant_admin',
            activo: true,
            mustChangePassword: false,
            mustChangeUsername: false
        }
    });
    console.log('Test user created: testadmin / Test1234');
    await prisma.$disconnect();
}

main().catch(console.error);
