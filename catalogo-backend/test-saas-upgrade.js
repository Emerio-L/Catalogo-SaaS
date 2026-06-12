require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { prisma } = require('./db');

const API = process.env.TEST_API_URL || 'http://localhost:3005';
const FRONTEND = process.env.TEST_FRONTEND_URL || 'http://localhost:4321';
const runId = Date.now().toString(36);
const tenantSlug = `test-upgrade-${runId}`;
const tenantPassword = `Tenant-${runId}-A1`;
const superPassword = `Super-${runId}-A1`;
const tenantEmail = `tenant-${runId}@example.test`;
const superEmail = `super-${runId}@example.test`;
const tenantUsername = `tenant${runId}`;
const superUsername = `super${runId}`;
const testPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=',
    'base64'
);

let tenant;
let testSuper;
const supportTicketIds = [];
const uploadedLocalFiles = [];

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
    console.log(`PASS: ${message}`);
}

async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        }
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
}

async function frontendRequest(pathname, options = {}) {
    const response = await fetch(`${FRONTEND}${pathname}`, options);
    const data = await response.json().catch(() => ({}));
    return { response, data };
}

async function login(path, identifier, password) {
    return request(path, {
        method: 'POST',
        body: JSON.stringify({ identifier, password })
    });
}

async function cleanup() {
    if (tenant?.id) {
        await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
    }
    if (testSuper?.id) {
        await prisma.user.delete({ where: { id: testSuper.id } }).catch(() => {});
    }
    if (supportTicketIds.length) {
        await prisma.supportTicket.deleteMany({ where: { id: { in: supportTicketIds } } }).catch(() => {});
    }
    for (const filePath of uploadedLocalFiles) {
        await fs.promises.unlink(filePath).catch(() => {});
    }
}

async function main() {
    const defaultTenant = await prisma.tenant.findUnique({ where: { slug: 'default' } });
    assert(defaultTenant, 'Tenant default disponible');

    testSuper = await prisma.user.create({
        data: {
            tenantId: defaultTenant.id,
            nombre: 'Super Test',
            email: superEmail,
            usuario: superUsername,
            passwordHash: await bcrypt.hash(superPassword, 12),
            rol: 'super_admin',
            activo: true
        }
    });

    const register = await request('/api/tenants/register', {
        method: 'POST',
        body: JSON.stringify({
            nombre: `Negocio Test ${runId}`,
            slug: tenantSlug,
            whatsapp: '50255550101',
            usuario: tenantUsername,
            email: tenantEmail,
            password: tenantPassword,
            tipoNegocio: 'personalizado'
        })
    });
    assert(register.response.status === 201, 'Registro multi-tenant funciona');
    tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    assert(/^CT-\d{6}$/.test(tenant.accountNumber), 'Numero de cuenta automatico y valido');

    const superUserLogin = await login('/api/super-admin/auth/login', superUsername, superPassword);
    assert(superUserLogin.response.ok, 'Login Super Admin con usuario');
    const superEmailLogin = await login('/api/super-admin/auth/login', superEmail, superPassword);
    assert(superEmailLogin.response.ok, 'Login Super Admin con email');
    const superToken = superEmailLogin.data.devSessionToken;
    const superHeaders = { Authorization: `Bearer ${superToken}` };

    const originalSaasSettings = await prisma.saasSettings.findUnique({ where: { key: 'global' } });
    const superLogoForm = new FormData();
    superLogoForm.append('logo', new Blob([testPng], { type: 'image/png' }), 'saas-logo-test.png');
    const superLogoUpload = await frontendRequest('/api/super-admin/settings/logo', {
        method: 'POST',
        headers: { ...superHeaders, Origin: FRONTEND },
        body: superLogoForm
    });
    assert(superLogoUpload.response.ok && superLogoUpload.data.logoUrl, 'Super User permite subir logo dinamico');
    if (String(superLogoUpload.data.logoUrl).startsWith('/uploads/')) {
        uploadedLocalFiles.push(path.join(__dirname, superLogoUpload.data.logoUrl.replace(/^\//, '')));
    }
    await prisma.saasSettings.update({
        where: { key: 'global' },
        data: {
            logoUrl: originalSaasSettings?.logoUrl || '',
            logoCloudinaryPublicId: originalSaasSettings?.logoCloudinaryPublicId || ''
        }
    });

    await prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'active', activo: true }
    });
    const pendingPayment = await prisma.payment.create({
        data: {
            tenantId: tenant.id,
            amount: 25,
            paymentMonth: `test-${runId}`,
            paymentMethod: 'transferencia',
            status: 'pendiente'
        }
    });
    const approvePayment = await request(`/api/super-admin/payments/${pendingPayment.id}/approve`, {
        method: 'PATCH',
        headers: superHeaders
    });
    assert(approvePayment.response.ok && approvePayment.data.payment.status === 'aprobado', 'Aprobar pago pendiente funciona');
    const tenantAfterPaymentApproval = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    assert(
        tenantAfterPaymentApproval.status === 'active' && tenantAfterPaymentApproval.activo === true,
        'Aprobar pago no modifica el estado de una cuenta activa'
    );

    const tenantUserLogin = await login(`/api/${tenantSlug}/auth/login`, tenantUsername, tenantPassword);
    assert(tenantUserLogin.response.ok, 'Login tenant admin con usuario');
    const tenantEmailLogin = await login(`/api/${tenantSlug}/auth/login`, tenantEmail, tenantPassword);
    assert(tenantEmailLogin.response.ok, 'Login tenant admin con email');
    const tenantAccountLogin = await login(`/api/${tenantSlug}/auth/login`, tenant.accountNumber, tenantPassword);
    assert(tenantAccountLogin.response.ok, 'Login tenant admin con numero de cuenta');
    const tenantToken = tenantAccountLogin.data.devSessionToken;
    const tenantHeaders = { Authorization: `Bearer ${tenantToken}` };
    const tenantUser = await prisma.user.findFirst({ where: { tenantId: tenant.id, rol: 'tenant_admin' } });

    const oldToken = `old-${runId}`;
    const oldReset = await prisma.passwordResetToken.create({
        data: {
            tenantId: tenant.id,
            userId: tenantUser.id,
            tokenHash: sha256(oldToken),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000)
        }
    });
    const forgot = await request('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ identifier: tenant.accountNumber })
    });
    assert(forgot.response.ok && /Si la cuenta existe/.test(forgot.data.mensaje), 'Forgot password devuelve respuesta generica');
    const invalidatedOld = await prisma.passwordResetToken.findUnique({ where: { id: oldReset.id } });
    assert(Boolean(invalidatedOld.usedAt), 'Forgot password invalida tokens anteriores');

    const validToken = `valid-${runId}`;
    await prisma.passwordResetToken.create({
        data: {
            tenantId: tenant.id,
            userId: tenantUser.id,
            tokenHash: sha256(validToken),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000)
        }
    });
    const resetPassword = `Reset-${runId}-A1`;
    const validReset = await request(`/api/${tenantSlug}/auth/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ token: validToken, password: resetPassword })
    });
    assert(validReset.response.ok, 'Reset password con token valido');
    const usedReset = await request(`/api/${tenantSlug}/auth/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ token: validToken, password: resetPassword })
    });
    assert(usedReset.response.status === 400, 'Token usado falla');

    const expiredToken = `expired-${runId}`;
    await prisma.passwordResetToken.create({
        data: {
            tenantId: tenant.id,
            userId: tenantUser.id,
            tokenHash: sha256(expiredToken),
            expiresAt: new Date(Date.now() - 1000)
        }
    });
    const expiredReset = await request(`/api/${tenantSlug}/auth/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ token: expiredToken, password: resetPassword })
    });
    assert(expiredReset.response.status === 400, 'Token expirado falla');

    const recovery = await request(`/api/super-admin/tenants/${tenant.id}/recovery`, {
        method: 'POST',
        headers: superHeaders,
        body: JSON.stringify({ method: 'whatsapp_code' })
    });
    assert(recovery.response.ok && /^\d{6}$/.test(recovery.data.code), 'Generar codigo WhatsApp desde Super Admin');
    const recoveredPassword = `Recovered-${runId}-A1`;
    const useCode = await request('/api/auth/recovery-code', {
        method: 'POST',
        body: JSON.stringify({
            identifier: tenant.accountNumber,
            code: recovery.data.code,
            password: recoveredPassword
        })
    });
    assert(useCode.response.ok, 'Usar codigo WhatsApp para cambiar contrasena');
    const reuseCode = await request('/api/auth/recovery-code', {
        method: 'POST',
        body: JSON.stringify({
            identifier: tenant.accountNumber,
            code: recovery.data.code,
            password: recoveredPassword
        })
    });
    assert(reuseCode.response.status === 400, 'Codigo WhatsApp solo se usa una vez');

    const relogin = await login(`/api/${tenantSlug}/auth/login`, tenantEmail, recoveredPassword);
    const currentTenantHeaders = { Authorization: `Bearer ${relogin.data.devSessionToken}` };
    const category = await prisma.category.create({
        data: { tenantId: tenant.id, nombre: 'Pruebas', orden: 1 }
    });
    const logoForm = new FormData();
    logoForm.append('logo', new Blob([testPng], { type: 'image/png' }), 'logo-test.png');
    const blockedLogoForm = new FormData();
    blockedLogoForm.append('logo', new Blob([testPng], { type: 'image/png' }), 'logo-blocked.png');
    const blockedOriginUpload = await frontendRequest(`/api/${tenantSlug}/admin/settings/logo`, {
        method: 'POST',
        headers: { ...currentTenantHeaders, Origin: 'https://example.invalid' },
        body: blockedLogoForm
    });
    assert(blockedOriginUpload.response.status === 403, 'Gateway rechaza multipart desde origen no permitido');
    const logoUpload = await frontendRequest(`/api/${tenantSlug}/admin/settings/logo`, {
        method: 'POST',
        headers: { ...currentTenantHeaders, Origin: FRONTEND },
        body: logoForm
    });
    assert(logoUpload.response.ok && logoUpload.data.logo, 'Gateway permite subir logo del catalogo');
    if (String(logoUpload.data.logo).startsWith('/uploads/')) {
        uploadedLocalFiles.push(path.join(__dirname, logoUpload.data.logo.replace(/^\//, '')));
    }

    const productForm = new FormData();
    productForm.append('nombre', 'Producto A');
    productForm.append('categoria', category.id);
    productForm.append('unidad', 'unidad');
    productForm.append('precio', '10');
    productForm.append('orden', '1');
    productForm.append('activo', 'true');
    productForm.append('foto', new Blob([testPng], { type: 'image/png' }), 'producto-test.png');
    const productUpload = await frontendRequest(`/api/${tenantSlug}/admin/products`, {
        method: 'POST',
        headers: { ...currentTenantHeaders, Origin: FRONTEND },
        body: productForm
    });
    const uploadedProductId = productUpload.data.producto?.id || productUpload.data.producto?._id;
    assert(productUpload.response.status === 201 && uploadedProductId, 'Gateway permite crear producto con foto');
    const productA = await prisma.product.findUnique({ where: { id: uploadedProductId } });
    if (String(productA.imagenUrl || '').startsWith('/uploads/')) {
        uploadedLocalFiles.push(path.join(__dirname, productA.imagenUrl.replace(/^\//, '')));
    }
    const productB = await prisma.product.create({
        data: {
            tenantId: tenant.id,
            categoriaId: category.id,
            categoria: category.nombre,
            nombre: 'Producto B',
            precio: 20,
            unidad: 'unidad',
            unidadMedida: 'unidad',
            activo: true
        }
    });
    const toggleA = await request(`/api/${tenantSlug}/admin/products/${productA.id}/toggle`, {
        method: 'PATCH',
        headers: currentTenantHeaders,
        body: JSON.stringify({ activo: false })
    });
    assert(toggleA.response.ok && toggleA.data.id === productA.id, 'Toggle responde con id real del producto A');
    const [afterA, afterB] = await Promise.all([
        prisma.product.findUnique({ where: { id: productA.id } }),
        prisma.product.findUnique({ where: { id: productB.id } })
    ]);
    assert(afterA.activo === false && afterB.activo === true, 'Activar/desactivar producto A no cambia producto B');
    const toggleB = await request(`/api/${tenantSlug}/admin/products/${productB.id}/toggle`, {
        method: 'PATCH',
        headers: currentTenantHeaders,
        body: JSON.stringify({ activo: false })
    });
    assert(toggleB.response.ok, 'Desactivar producto filtrado usa id estable');

    const order = await request(`/api/${tenantSlug}/orders`, {
        method: 'POST',
        body: JSON.stringify({
            cliente: { nombre: 'Cliente Test', telefono: '50255550102' },
            productos: [{ productId: productA.id, nombre: productA.nombre, cantidad: 1, unidad: 'unidad' }],
            total: 10,
            channel: 'cart'
        })
    });
    assert(order.response.status === 201, 'Carrito y pedidos siguen funcionando');

    const support = await frontendRequest('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Cliente Soporte Test',
            email: `support-${runId}@example.test`,
            whatsapp: '50255550103',
            message: 'Necesito ayuda con una prueba automatizada.'
        })
    });
    assert(support.response.status === 201, 'Soporte desde landing crea ticket');
    supportTicketIds.push(support.data.ticketId);
    const supportList = await request('/api/super-admin/support/tickets', { headers: superHeaders });
    assert(supportList.response.ok && supportList.data.tickets.some(ticket => ticket.id === support.data.ticketId), 'Ticket aparece en Super Admin');
    const deleteSupport = await request(`/api/super-admin/support/tickets/${support.data.ticketId}`, {
        method: 'DELETE',
        headers: superHeaders
    });
    assert(deleteSupport.response.ok, 'Super User puede eliminar mensajes de soporte');

    const settings = await request(`/api/${tenantSlug}/admin/settings`, { headers: currentTenantHeaders });
    assert(settings.response.ok && settings.data.mostrarDescripcion === false, 'Configuracion mantiene descripcion desactivada');

    const [publicCatalog, adminPanel, landing, superAdmin] = await Promise.all([
        fetch(`${FRONTEND}/c/${tenantSlug}`),
        fetch(`${FRONTEND}/c/${tenantSlug}/p/${tenant.adminAccessKey}`),
        fetch(`${FRONTEND}/`),
        fetch(`${FRONTEND}/super-admin`)
    ]);
    assert(publicCatalog.ok, 'Catalogo publico responde');
    assert(adminPanel.ok, 'Panel admin tenant responde');
    assert(landing.ok, 'Landing responde');
    assert(superAdmin.ok, 'Super Admin responde');
    const adminHtml = await adminPanel.text();
    const landingHtml = await landing.text();
    assert(!adminHtml.includes('Mostrar descripcion del negocio'), 'Configuracion ya no muestra el control de descripcion');
    assert(landingHtml.includes('setTimeout(closeSupportModal, 30000)'), 'Exito de soporte permanece visible 30 segundos');

    const dashboard = await request('/api/super-admin/dashboard', { headers: superHeaders });
    const logs = await request('/api/super-admin/logs', { headers: superHeaders });
    assert(dashboard.response.ok && typeof dashboard.data.mrr === 'number', 'Dashboard Super User expone MRR y metricas');
    assert(logs.response.ok && Array.isArray(logs.data), 'Logs Super User disponibles');
    const logToDelete = logs.data.find(log => log.id);
    assert(Boolean(logToDelete), 'Existe un log para probar eliminacion');
    const deleteLog = await request(`/api/super-admin/logs/${logToDelete.id}`, {
        method: 'DELETE',
        headers: superHeaders
    });
    assert(deleteLog.response.ok, 'Super User puede eliminar logs');

    const saasSettings = await request('/api/super-admin/settings', { headers: superHeaders });
    assert(
        saasSettings.response.ok && typeof saasSettings.data.emailRecoveryConfigured === 'boolean',
        'Super User muestra estado de configuracion del correo'
    );
}

main()
    .then(() => console.log('ALL TESTS PASSED'))
    .catch(error => {
        console.error(`TEST FAILED: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await cleanup();
        await prisma.$disconnect();
    });
