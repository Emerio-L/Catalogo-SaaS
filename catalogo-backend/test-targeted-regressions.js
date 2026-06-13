const bcrypt = require('bcryptjs');
const { prisma } = require('./db');

const API = process.env.TEST_API_URL || 'http://localhost:3005';
const FRONTEND = process.env.TEST_FRONTEND_URL || 'http://localhost:4321';
const runId = Date.now().toString(36);
const tenantSlug = `test-regressions-${runId}`;
const tenantPassword = `Tenant-${runId}-A1`;
const superPassword = `Super-${runId}-A1`;
const tenantEmail = `tenant-regressions-${runId}@example.test`;
const superEmail = `super-regressions-${runId}@example.test`;
const tenantUsername = `tenantreg${runId}`;
const superUsername = `superreg${runId}`;

let tenantId = '';
let superUserId = '';
let supportTicketId = '';
let auditLogId = '';

function assert(condition, message) {
    if (!condition) throw new Error(message);
    console.log(`PASS: ${message}`);
}

async function request(baseUrl, path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, options);
    const data = await response.json().catch(() => ({}));
    return { response, data };
}

async function gatewayRequest(path, options = {}) {
    return request(FRONTEND, path, {
        ...options,
        headers: {
            Origin: FRONTEND,
            ...(options.headers || {})
        }
    });
}

async function cleanup() {
    if (supportTicketId) {
        await prisma.supportTicket.deleteMany({ where: { id: supportTicketId } }).catch(() => {});
    }
    if (auditLogId) {
        await prisma.auditLog.deleteMany({ where: { id: auditLogId } }).catch(() => {});
    }
    if (tenantId) {
        await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
    }
    if (superUserId) {
        await prisma.user.deleteMany({ where: { id: superUserId } }).catch(() => {});
    }
}

async function main() {
    const defaultTenant = await prisma.tenant.findUnique({ where: { slug: 'default' } });
    assert(defaultTenant, 'Tenant default disponible');

    const superUser = await prisma.user.create({
        data: {
            tenantId: defaultTenant.id,
            nombre: 'Super Regression Test',
            email: superEmail,
            usuario: superUsername,
            passwordHash: await bcrypt.hash(superPassword, 12),
            rol: 'super_admin',
            activo: true
        }
    });
    superUserId = superUser.id;

    const register = await request(API, '/api/tenants/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            nombre: `Regression Test ${runId}`,
            slug: tenantSlug,
            whatsapp: '50255550101',
            usuario: tenantUsername,
            email: tenantEmail,
            password: tenantPassword,
            tipoNegocio: 'personalizado'
        })
    });
    assert(register.response.status === 201, 'Cuenta temporal creada');

    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    tenantId = tenant.id;
    await prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'active', activo: true }
    });

    const tenantLogin = await request(API, `/api/${tenantSlug}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: tenantUsername, password: tenantPassword })
    });
    assert(tenantLogin.response.ok && tenantLogin.data.devSessionToken, 'Sesion tenant creada');
    const tenantAuth = { Authorization: `Bearer ${tenantLogin.data.devSessionToken}` };

    const superLogin = await request(API, '/api/super-admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: superUsername, password: superPassword })
    });
    assert(superLogin.response.ok && superLogin.data.devSessionToken, 'Sesion super admin creada');
    const superAuth = { Authorization: `Bearer ${superLogin.data.devSessionToken}` };

    await prisma.category.create({
        data: { tenantId: tenant.id, nombre: 'Verduras', orden: 1 }
    });
    const duplicateCategory = await gatewayRequest(`/api/${tenantSlug}/admin/categories`, {
        method: 'POST',
        headers: { ...tenantAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: '  verduras  ', orden: 2 })
    });
    assert(
        duplicateCategory.response.status === 409 && duplicateCategory.data.error === 'La categoría ya existe.',
        'Categoria duplicada devuelve mensaje explicito'
    );

    const rotateLogo = await gatewayRequest(`/api/${tenantSlug}/admin/settings`, {
        method: 'PUT',
        headers: { ...tenantAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoRotation: 90 })
    });
    assert(rotateLogo.response.ok, 'Orientacion de imagen guardada');
    const publicSettings = await gatewayRequest(`/api/${tenantSlug}/settings`);
    assert(publicSettings.data.logoRotation === 90, 'Orientacion disponible en catalogo publico');

    const supportTicket = await prisma.supportTicket.create({
        data: {
            name: 'Support Regression Test',
            email: tenantEmail,
            whatsapp: '50255550102',
            message: 'Mensaje temporal para probar eliminacion.',
            status: 'open'
        }
    });
    supportTicketId = supportTicket.id;
    const deleteSupport = await gatewayRequest(`/api/super-admin/support/tickets/${supportTicket.id}`, {
        method: 'DELETE',
        headers: superAuth
    });
    assert(deleteSupport.response.ok, 'Mensaje de soporte eliminado por el gateway');
    supportTicketId = '';

    const auditLog = await prisma.auditLog.create({
        data: { tipo: 'targeted_regression_test', metadata: { runId } }
    });
    auditLogId = auditLog.id;
    const deleteLog = await gatewayRequest(`/api/super-admin/logs/${auditLog.id}`, {
        method: 'DELETE',
        headers: superAuth
    });
    assert(deleteLog.response.ok, 'Log eliminado por el gateway');
    auditLogId = '';
}

main()
    .then(() => console.log('TARGETED REGRESSION TESTS PASSED'))
    .catch(error => {
        console.error(`TEST FAILED: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await cleanup();
        await prisma.$disconnect();
    });
