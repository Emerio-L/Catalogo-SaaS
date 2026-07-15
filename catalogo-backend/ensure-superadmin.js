require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { createTenantWithAccountNumber } = require('./account-numbers');

const prisma = new PrismaClient();

function createAdminAccessKey() {
    return `panel-${crypto.randomBytes(9).toString('hex')}`;
}

async function main() {
    const now = new Date();
    const superUser = (process.env.SUPER_ADMIN_USER || '').toLowerCase().trim();
    const superEmail = (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();
    const superPassword = process.env.SUPER_ADMIN_PASSWORD || '';
    if (!superUser || !superEmail || !superPassword) {
        throw new Error('SUPER_ADMIN_USER, SUPER_ADMIN_EMAIL y SUPER_ADMIN_PASSWORD son obligatorios.');
    }

    const existingSuperAdmin = await prisma.user.findFirst({
        where: { rol: 'super_admin' },
        orderBy: { creadoEn: 'asc' }
    });
    let tenant = existingSuperAdmin
        ? await prisma.tenant.findUnique({ where: { id: existingSuperAdmin.tenantId } })
        : await prisma.tenant.findUnique({ where: { slug: 'default' } });
    if (!existingSuperAdmin && tenant) {
        const identityConflict = await prisma.user.findFirst({
            where: {
                tenantId: tenant.id,
                OR: [{ email: superEmail }, { usuario: superUser }]
            }
        });
        if (identityConflict) tenant = null;
    }
    if (!tenant && !existingSuperAdmin) {
        tenant = await prisma.tenant.findFirst({
            where: {
                users: {
                    none: { OR: [{ email: superEmail }, { usuario: superUser }] }
                }
            },
            orderBy: { creadoEn: 'asc' }
        });
    }
    if (!tenant) {
        tenant = await prisma.tenant.findFirst({ orderBy: { creadoEn: 'asc' } });
    }
    if (!tenant) {
        tenant = await createTenantWithAccountNumber(prisma, {
            slug: 'default',
            nombre: 'Catalogo de Productos',
            descripcion: 'Selecciona tus productos y confirma tu pedido.',
            whatsapp: '50235387468',
            adminAccessKey: createAdminAccessKey(),
            activo: true,
            status: 'trial',
            trialStartDate: now,
            trialEndDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            billingDay: now.getDate()
        });
    }

    await prisma.settings.upsert({
        where: { tenantId: tenant.id },
        update: {},
        create: {
            tenantId: tenant.id,
            whatsapp: tenant.whatsapp,
            colorPrimario: tenant.colorPrimario || '#10b981',
            logo: tenant.logo || '',
            logoShape: 'rectangle',
            catalogTitle: 'Catalogo de productos',
            tema: 'emerald',
            mostrarBuscador: true,
            mostrarCategorias: true,
            mostrarDescripcion: true,
            vistaPredeterminada: 'grid',
            monedaVisible: 'GTQ'
        }
    });

    if (existingSuperAdmin) {
        const passwordMatches = await bcrypt.compare(superPassword, existingSuperAdmin.passwordHash);
        await prisma.user.update({
            where: { id: existingSuperAdmin.id },
            data: {
                nombre: process.env.SUPER_ADMIN_NAME || existingSuperAdmin.nombre || 'Super Administrador',
                activo: true,
                failedLoginAttempts: 0,
                lockedUntil: null,
                ...(passwordMatches ? {} : { passwordHash: await bcrypt.hash(superPassword, 12) })
            }
        });

        try {
            await prisma.user.update({
                where: { id: existingSuperAdmin.id },
                data: { email: superEmail, usuario: superUser }
            });
        } catch (error) {
            if (error?.code !== 'P2002') throw error;
            console.warn('Super admin password restored; username/email already belongs to another user in the same tenant.');
        }

        console.log(`Super admin credentials synchronized from server variables: ${superUser}`);
        return;
    }

    await prisma.user.create({
        data: {
            tenantId: tenant.id,
            nombre: process.env.SUPER_ADMIN_NAME || 'Super Administrador',
            email: superEmail,
            usuario: superUser,
            passwordHash: await bcrypt.hash(superPassword, 12),
            rol: 'super_admin',
            activo: true
        }
    });

    console.log(`Super admin created: ${superUser}`);
}

main()
    .catch((err) => {
        console.error('Error ensuring super admin:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
