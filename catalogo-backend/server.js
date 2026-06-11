require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { v2: cloudinary } = require('cloudinary');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const {
    Tenant,
    Category,
    Producto,
    Settings,
    Pedido,
    User,
    Session,
    PasswordResetToken,
    RecoveryCode,
    SupportTicket,
    AuditLog,
    Plan,
    Payment,
    AccountStatusLog,
    SaasSettings,
    isValidUuid,
    prisma
} = require('./data-access');
const tenantMiddleware = require('./middleware/tenant.middleware');
const { nextAccountNumber } = require('./account-numbers');

const app = express();
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

const configuredOrigins = (process.env.FRONTEND_URL || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
const allowedOrigins = new Set(configuredOrigins);

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        const normalizedOrigin = origin.replace(/\/$/, '');
        if (allowedOrigins.has(normalizedOrigin)) {
            return callback(null, true);
        }
        return callback(new Error('Origen no permitido por CORS'));
    },
    credentials: true
}));
app.use(helmet({
    crossOriginResourcePolicy: false, // Permitir cargar imágenes en frontend externo temporalmente si fuera necesario
}));
app.use(compression());
app.use(express.json());
app.use(cookieParser());

const cloudinaryEnabled = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);
if (process.env.NODE_ENV === 'production' && !cloudinaryEnabled) {
    throw new Error('Cloudinary es obligatorio en produccion para conservar imagenes y archivos.');
}
const ADMIN_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const ACCOUNT_STATUSES = ['trial', 'active', 'pending_payment', 'suspended', 'deleted'];
const PAYMENT_STATUSES = ['pendiente', 'aprobado', 'rechazado'];
const SUPPORT_TICKET_STATUSES = ['open', 'in_progress', 'closed'];
const SUPER_ADMIN_COOKIE = 'catalogo_super_admin_session';
const DELETED_ACCOUNT_RETENTION_DAYS = 30;
const DEFAULT_TENANT_THEME = {
    mode: 'default',
    selectedColor: '#3B82F6',
    businessCategory: null,
    paletteName: 'Paleta default',
    colors: {
        primary: '#3B82F6',
        primaryHover: '#1D4ED8',
        secondary: '#38BDF8',
        background: '#0B1120',
        surface: '#1E293B',
        button: '#2563EB',
        text: '#F8FAFC',
        accent: '#06B6D4',
        success: '#22C55E',
        warning: '#F59E0B',
        error: '#EF4444'
    }
};

if (cloudinaryEnabled) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
}

// Servir la carpeta de imágenes públicamente
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Configuración de almacenamiento en memoria para Multer
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // límite de 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype.includes('pdf')) {
            cb(null, true);
        } else {
            cb(new Error('Formato no soportado: ' + file.mimetype));
        }
    }
});



app.get('/health', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({
            ok: true,
            service: 'catalogo-backend',
            postgres: 'connected',
            cloudinary: cloudinaryEnabled
        });
    } catch (error) {
        console.error('Healthcheck de PostgreSQL fallido:', error);
        res.status(503).json({
            ok: false,
            service: 'catalogo-backend',
            postgres: 'disconnected',
            cloudinary: cloudinaryEnabled
        });
    }
});

const CATEGORIAS_DEFAULT = [
    { nombre: 'Verduras', orden: 1 },
    { nombre: 'Frutas', orden: 2 },
    { nombre: 'Otros', orden: 3 }
];

const CATEGORIAS_POR_TIPO_NEGOCIO = {
    verduleria: [
        { nombre: 'Verduras', orden: 1 },
        { nombre: 'Frutas', orden: 2 },
        { nombre: 'Otros', orden: 3 }
    ],
    abarrotes: [
        { nombre: 'Bebidas', orden: 1 },
        { nombre: 'Snacks', orden: 2 },
        { nombre: 'Limpieza', orden: 3 },
        { nombre: 'Lácteos', orden: 4 },
        { nombre: 'Otros', orden: 5 }
    ],
    electronica: [
        { nombre: 'Celulares', orden: 1 },
        { nombre: 'Accesorios', orden: 2 },
        { nombre: 'Audio', orden: 3 },
        { nombre: 'Computadoras', orden: 4 },
        { nombre: 'Otros', orden: 5 }
    ],
    personalizado: []
};

const DIAS_RETENCION_RECIBOS = 90;

function fechaLimiteRetencionRecibos() {
    return new Date(Date.now() - DIAS_RETENCION_RECIBOS * 24 * 60 * 60 * 1000);
}

async function limpiarPedidosExpirados(tenantId) {
    return Pedido.deleteMany({ tenantId, fecha: { $lt: fechaLimiteRetencionRecibos() } });
}

function crearAdminAccessKey() {
    return `panel-${crypto.randomBytes(9).toString('hex')}`;
}

function normalizarSlug(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

function sha256(valor) {
    return crypto.createHash('sha256').update(valor).digest('hex');
}

function crearTokenSeguro(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url');
}

function normalizeIdentifier(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeAccountNumber(value) {
    return String(value || '').trim().toUpperCase();
}

async function createTenantWithAccountNumber(data) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await Tenant.create({
                ...data,
                accountNumber: await nextAccountNumber(prisma)
            });
        } catch (error) {
            if (error?.code !== 'P2002' || !String(error?.meta?.target || '').includes('accountNumber')) {
                throw error;
            }
        }
    }
    throw new Error('No se pudo generar un numero de cuenta unico');
}

async function findUserByIdentifier(identifier, options = {}) {
    const normalized = normalizeIdentifier(identifier);
    const accountNumber = normalizeAccountNumber(identifier);
    const baseQuery = {
        activo: true,
        ...(options.tenantId ? { tenantId: options.tenantId } : {}),
        ...(options.role ? { rol: options.role } : {})
    };

    let user = await User.findOne({
        ...baseQuery,
        $or: [{ email: normalized }, { usuario: normalized }]
    });
    if (user) return user;

    const tenant = await Tenant.findOne({
        accountNumber,
        ...(options.tenantId ? { _id: options.tenantId } : {}),
        status: { $ne: 'deleted' }
    });
    if (!tenant) return null;

    return User.findOne({
        ...baseQuery,
        tenantId: tenant._id,
        ...(options.role
            ? { rol: options.role }
            : { $or: [{ rol: 'owner' }, { rol: 'tenant_admin' }, { rol: 'admin' }] })
    }).sort({ creadoEn: 1 });
}

async function invalidateActiveResetTokens(userId, tenantId) {
    await PasswordResetToken.updateMany(
        { userId, tenantId, usedAt: null },
        { $set: { usedAt: new Date() } }
    );
}

async function createPasswordResetForUser(req, user, tenant) {
    await invalidateActiveResetTokens(user._id, tenant._id);
    const token = crearTokenSeguro();
    await PasswordResetToken.create({
        tenantId: tenant._id,
        userId: user._id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        ip: req.ip
    });
    const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host').replace(':3005', ':4321')}`;
    const resetUrl = `${frontendUrl}/c/${tenant.slug}/reset-password?token=${token}`;
    const emailStatus = await enviarEmailRecuperacion({ to: user.email, resetUrl });
    return { resetUrl, emailStatus };
}

function cookieName(tenantSlug) {
    return `catalogo_session_${tenantSlug}`;
}

function superAdminCookieOptions() {
    return cookieOptions();
}

function nuevaExpiracionSesion() {
    return new Date(Date.now() + ADMIN_IDLE_TIMEOUT_MS);
}

function startOfDay(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + Number(days || 0));
    return d;
}

function clampBillingDay(year, month, billingDay) {
    return Math.min(Number(billingDay || 1), new Date(year, month + 1, 0).getDate());
}

function nextBillingDate(fromDate, billingDay) {
    const from = new Date(fromDate);
    const day = Number(billingDay || from.getDate() || 1);
    const currentMonthDate = new Date(from.getFullYear(), from.getMonth(), clampBillingDay(from.getFullYear(), from.getMonth(), day));
    if (currentMonthDate > from) return currentMonthDate;
    const nextMonth = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    return new Date(nextMonth.getFullYear(), nextMonth.getMonth(), clampBillingDay(nextMonth.getFullYear(), nextMonth.getMonth(), day));
}

function money(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function accountStatusLabel(status) {
    return {
        trial: 'En prueba gratis',
        active: 'Al dia',
        pending_payment: 'Pendiente de pago',
        suspended: 'Suspendida',
        deleted: 'Eliminada'
    }[status] || status;
}

function daysRemainingUntil(date) {
    if (!date) return null;
    return Math.ceil((startOfDay(date).getTime() - startOfDay().getTime()) / (24 * 60 * 60 * 1000));
}

async function logAccountStatus(tenant, previousStatus, newStatus, reason, changedBy = null) {
    if (!tenant?._id || previousStatus === newStatus) return;
    await AccountStatusLog.create({
        tenantId: tenant._id,
        previousStatus,
        newStatus,
        reason,
        changedBy
    });
}

async function ensureTenantBillingDefaults(tenant) {
    if (!tenant) return tenant;
    let changed = false;
    const now = new Date();

    if (!tenant.status) {
        tenant.status = tenant.activo === false ? 'suspended' : 'trial';
        changed = true;
    }
    if (!tenant.trialStartDate && tenant.status === 'trial') {
        tenant.trialStartDate = tenant.creadoEn || now;
        changed = true;
    }
    if (tenant.status === 'trial' && !tenant.trialEndDate) {
        tenant.trialEndDate = addDays(tenant.trialStartDate || now, 7);
        changed = true;
    }
    if (!tenant.billingDay) {
        tenant.billingDay = (tenant.creadoEn || now).getDate();
        changed = true;
    }
    if (!tenant.currentPeriodStart && tenant.status !== 'trial') {
        tenant.currentPeriodStart = tenant.lastPaymentAt || tenant.creadoEn || now;
        changed = true;
    }
    if (!tenant.currentPeriodEnd && tenant.currentPeriodStart) {
        tenant.currentPeriodEnd = nextBillingDate(tenant.currentPeriodStart, tenant.billingDay);
        changed = true;
    }
    if (!tenant.paymentDueDate && tenant.currentPeriodEnd) {
        const plan = tenant.planId ? await Plan.findById(tenant.planId) : null;
        tenant.paymentDueDate = addDays(tenant.currentPeriodEnd, plan?.graceDays || 0);
        changed = true;
    }
    if (tenant.status === 'deleted' && !tenant.deletedAt) {
        tenant.deletedAt = now;
        changed = true;
    }
    if (changed) await tenant.save();
    return tenant;
}

async function applyAccountTransitions(tenantsInput) {
    const tenants = Array.isArray(tenantsInput) ? tenantsInput : [tenantsInput].filter(Boolean);
    const now = startOfDay();

    for (const tenant of tenants) {
        await ensureTenantBillingDefaults(tenant);
        if (!tenant || tenant.status === 'deleted') continue;

        const previousStatus = tenant.status;
        if (tenant.status === 'trial' && tenant.trialEndDate && startOfDay(tenant.trialEndDate) < now) {
            tenant.status = 'pending_payment';
        }

        const approvedAfterPeriod = tenant.currentPeriodEnd
            ? await Payment.exists({
                tenantId: tenant._id,
                status: 'aprobado',
                approvedAt: { $gte: tenant.currentPeriodEnd }
            })
            : null;

        if (
            ['active', 'pending_payment'].includes(tenant.status) &&
            tenant.paymentDueDate &&
            startOfDay(tenant.paymentDueDate) < now &&
            !approvedAfterPeriod
        ) {
            tenant.status = 'suspended';
            tenant.suspendedAt = tenant.suspendedAt || new Date();
        }

        if (tenant.status !== previousStatus) {
            tenant.activo = tenant.status !== 'suspended' && tenant.status !== 'deleted';
            await tenant.save();
            await logAccountStatus(tenant, previousStatus, tenant.status, 'Cambio automatico por ciclo de facturacion');
        }
    }
}

function tenantBillingPayload(tenant, plan = null) {
    return {
        accountNumber: tenant.accountNumber,
        status: tenant.status,
        statusLabel: accountStatusLabel(tenant.status),
        plan: plan ? {
            id: plan._id,
            name: plan.name,
            monthlyPrice: plan.monthlyPrice,
            trialDays: plan.trialDays,
            graceDays: plan.graceDays,
            productLimit: plan.productLimit,
            features: plan.features || [],
            isActive: plan.isActive
        } : null,
        planName: plan?.name || 'Sin plan',
        monthlyPrice: money(tenant.monthlyPrice || plan?.monthlyPrice || 0),
        trialStartDate: tenant.trialStartDate,
        trialEndDate: tenant.trialEndDate,
        trialDaysRemaining: daysRemainingUntil(tenant.trialEndDate),
        billingDay: tenant.billingDay,
        currentPeriodStart: tenant.currentPeriodStart,
        currentPeriodEnd: tenant.currentPeriodEnd,
        paymentDueDate: tenant.paymentDueDate,
        lastPaymentAt: tenant.lastPaymentAt,
        suspendedAt: tenant.suspendedAt,
        deletedAt: tenant.deletedAt,
        deletedReason: tenant.deletedReason || ''
    };
}

async function serializeTenantForSuperAdmin(tenant) {
    const plan = tenant.planId && tenant.planId.name ? tenant.planId : (tenant.planId ? await Plan.findById(tenant.planId) : null);
    const owner = await User.findOne({ tenantId: tenant._id, rol: { $ne: 'super_admin' } }).sort({ creadoEn: 1 }).lean();
    const lastPayment = await Payment.findOne({ tenantId: tenant._id, status: 'aprobado' }).sort({ approvedAt: -1, paidAt: -1 }).lean();
    return {
        id: tenant._id,
        accountNumber: tenant.accountNumber,
        slug: tenant.slug,
        businessName: tenant.nombre,
        ownerName: tenant.ownerName || owner?.nombre || '',
        whatsapp: tenant.whatsapp,
        email: tenant.email || owner?.email || '',
        logoUrl: tenant.logo,
        createdAt: tenant.creadoEn,
        updatedAt: tenant.updatedAt,
        adminUrl: `/c/${tenant.slug}/p/${tenant.adminAccessKey}`,
        publicUrl: `/c/${tenant.slug}`,
        lastPayment,
        lastLoginAt: owner?.ultimoLogin || null,
        internalNotes: tenant.internalNotes || '',
        ...tenantBillingPayload(tenant, plan)
    };
}

async function saasSettings() {
    return SaasSettings.findOneAndUpdate(
        { key: 'global' },
        { $setOnInsert: { key: 'global' } },
        { upsert: true, new: true }
    );
}

function saasSettingsPayload(settings) {
    return {
        supportWhatsapp: settings.supportWhatsapp || '',
        supportMessage: settings.supportMessage || 'Hola, necesito ayuda con mi catalogo.',
        emulatorUrl: settings.emulatorUrl || '',
        emulatorEnabled: Boolean(settings.emulatorEnabled),
        logoUrl: settings.logoUrl || '',
        monthlyPrice: typeof settings.monthlyPrice === 'number' ? settings.monthlyPrice : 50,
        freeTrialDays: typeof settings.freeTrialDays === 'number' ? settings.freeTrialDays : 7,
        logoAltText: settings.logoAltText || 'SEDELYNK',
        primaryColor: settings.primaryColor || '#7C3AED',
        secondaryColor: settings.secondaryColor || '#D946EF',
        accentColor: settings.accentColor || '#FF6B1A',
        showPrice: settings.showPrice !== false,
        
        // New global settings
        platformName: settings.platformName || 'sedelynk',
        supportEmail: settings.supportEmail || 'soporte@sedelynk.com',
        supportUrl: settings.supportUrl || 'https://soporte.sedelynk.com',
        timezone: settings.timezone || 'America/Guatemala',
        currency: settings.currency || 'GTQ',
        faviconUrl: settings.faviconUrl || '',
        
        // Landing contents
        landingHeroText: settings.landingHeroText || 'Crea tu tienda en línea, recibe pedidos y haz crecer tu negocio. Sin comisiones, sin complicaciones.',
        landingTitle: settings.landingTitle || 'Vende cualquier producto en línea por',
        landingSubtitle: settings.landingSubtitle || 'carrito y WhatsApp',
        landingFaqs: settings.landingFaqs || '[]',
        
        // Notifications configs
        notificationEmails: settings.notificationEmails !== false,
        notificationPaymentReminders: settings.notificationPaymentReminders !== false,
        notificationUpcomingExpirations: settings.notificationUpcomingExpirations !== false,
        notificationWelcomeMessages: settings.notificationWelcomeMessages !== false,

        updatedAt: settings.updatedAt
    };
}

async function purgeDeletedTenants() {
    const cutoff = new Date(Date.now() - DELETED_ACCOUNT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const tenants = await Tenant.find({ status: 'deleted', deletedAt: { $lte: cutoff } });
    for (const tenant of tenants) {
        await Promise.allSettled([
            Category.deleteMany({ tenantId: tenant._id }),
            Producto.deleteMany({ tenantId: tenant._id }),
            Settings.deleteOne({ tenantId: tenant._id }),
            Pedido.deleteMany({ tenantId: tenant._id }),
            User.deleteMany({ tenantId: tenant._id, rol: { $ne: 'super_admin' } }),
            Session.deleteMany({ tenantId: tenant._id }),
            Payment.deleteMany({ tenantId: tenant._id }),
            AccountStatusLog.deleteMany({ tenantId: tenant._id })
        ]);
        await Tenant.deleteOne({ _id: tenant._id });
    }
    return tenants.length;
}

function requireTenantOperational(req, res, next) {
    if (req.tenant.status === 'deleted') {
        return res.status(404).json({ error: 'Catalogo no encontrado', status: req.tenant.status });
    }
    if (req.tenant.status === 'suspended') {
        const esAdmin = req.originalUrl && req.originalUrl.includes('/admin/');
        if (!esAdmin) {
            return res.status(403).json({
                error: 'Este catálogo no está disponible temporalmente.',
                status: req.tenant.status,
                statusLabel: 'No disponible'
            });
        }
        return res.status(403).json({
            error: 'Cuenta suspendida. Realiza el pago para reactivar el catalogo.',
            status: req.tenant.status,
            statusLabel: accountStatusLabel(req.tenant.status)
        });
    }
    next();
}

function esHexColor(valor) {
    return typeof valor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(valor);
}

function normalizarThemeTenant(theme) {
    if (!theme || typeof theme !== 'object') return DEFAULT_TENANT_THEME;
    const baseColors = DEFAULT_TENANT_THEME.colors;
    const inputColors = theme.colors && typeof theme.colors === 'object' ? theme.colors : {};
    const colors = {};
    const selectedInput = esHexColor(theme.selectedColor) ? theme.selectedColor.toUpperCase() : null;
    for (const key of Object.keys(baseColors)) {
        colors[key] = esHexColor(inputColors[key]) ? inputColors[key].toUpperCase() : baseColors[key];
    }
    if (!esHexColor(inputColors.primary) && selectedInput) colors.primary = selectedInput;
    colors.primaryHover = esHexColor(colors.primaryHover) ? colors.primaryHover : colors.button;
    colors.button = esHexColor(colors.button) ? colors.button : colors.primary;
    const selectedColor = selectedInput || colors.primary;
    const mode = ['default', 'custom', 'business_suggestion'].includes(theme.mode) ? theme.mode : 'default';
    return {
        mode,
        selectedColor,
        businessCategory: theme.businessCategory ? String(theme.businessCategory).slice(0, 80) : null,
        paletteName: theme.paletteName ? String(theme.paletteName).slice(0, 80) : DEFAULT_TENANT_THEME.paletteName,
        colors
    };
}

function cookieOptions() {
    return {
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: ADMIN_IDLE_TIMEOUT_MS
    };
}

function clearCookieOptions() {
    const { maxAge, ...options } = cookieOptions();
    return options;
}

async function auditLog(req, tipo, metadata = {}) {
    try {
        await AuditLog.create({
            tenantId: metadata.tenantId || req.tenantId,
            userId: req.user?._id,
            tipo,
            ip: req.ip,
            userAgent: req.get('user-agent') || '',
            metadata
        });
    } catch (err) {
        console.error('Error registrando auditoría:', err.message);
    }
}

async function enviarEmailRecuperacion({ to, resetUrl }) {
    if (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM) {
        console.log(`Link de recuperación para ${to}: ${resetUrl}`);
        return { sent: false, dev: true };
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: process.env.AUTH_EMAIL_FROM,
            to,
            subject: 'Recupera tu acceso al catálogo',
            html: `
                <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
                    <h2>Recupera tu acceso</h2>
                    <p>Usa este enlace para crear una nueva contraseña. Expira en 15 minutos.</p>
                    <p><a href="${resetUrl}" style="background:#0f172a;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold">Cambiar contraseña</a></p>
                    <p>Si no solicitaste este cambio, ignora este correo.</p>
                </div>
            `
        })
    });

    if (!response.ok) {
        throw new Error('No se pudo enviar el correo de recuperación');
    }

    return { sent: true, dev: false };
}

async function enviarEmailBienvenida({ to, tenant, usuario }) {
    if (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM || !to || String(to).endsWith('.local')) {
        return { sent: false, dev: true };
    }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4321';
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: process.env.AUTH_EMAIL_FROM,
            to,
            subject: `Bienvenido a SEDELYNK - ${tenant.accountNumber}`,
            html: `
                <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
                    <h2>Tu cuenta SEDELYNK esta lista</h2>
                    <p><strong>Numero de cuenta:</strong> ${tenant.accountNumber}</p>
                    <p><strong>Negocio:</strong> ${tenant.nombre}</p>
                    <p><strong>Usuario:</strong> ${usuario}</p>
                    <p><a href="${frontendUrl}/" style="background:#7C3AED;color:white;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:bold">Ingresar a SEDELYNK</a></p>
                </div>
            `
        })
    });
    if (!response.ok) throw new Error('No se pudo enviar el correo de bienvenida');
    return { sent: true, dev: false };
}

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
});

const recoveryCodeLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de recuperacion. Intenta mas tarde.' }
});

const supportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes de soporte. Intenta mas tarde.' }
});

function normalizarCategoria(nombre) {
    return String(nombre || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function productoResponse(producto, categoria) {
    const doc = producto.toObject ? producto.toObject() : producto;
    const nombreCategoria = categoria?.nombre || doc.categoria || 'Otros';
    const categoriaId = categoria?._id || doc.categoriaId?._id || doc.categoriaId;
    const unidadMedida = doc.unidadMedida || doc.unidad || '';
    const imagenUrl = doc.imagenUrl || doc.imagen || '/uploads/placeholder.webp';
    const ordenVisualizacion = doc.ordenVisualizacion ?? doc.orden ?? 999;

    return {
        ...doc,
        categoria: nombreCategoria,
        categoriaId,
        unidad: unidadMedida,
        unidadMedida,
        imagen: imagenUrl,
        imagenUrl,
        orden: ordenVisualizacion,
        ordenVisualizacion,
        cloudinaryPublicId: doc.cloudinaryPublicId
    };
}

async function buscarCategoriaTenant(tenantId, categoriaInput) {
    if (categoriaInput && isValidUuid(categoriaInput)) {
        const categoriaPorId = await Category.findOne({ _id: categoriaInput, tenantId });
        if (categoriaPorId) return categoriaPorId;
    }

    const nombreNormalizado = normalizarCategoria(categoriaInput);
    const categorias = await Category.find({ tenantId }).sort('orden');
    return categorias.find(cat => normalizarCategoria(cat.nombre) === nombreNormalizado) || categorias[0] || null;
}

async function asegurarTenantDefault() {
    let tenant = await Tenant.findOne({ slug: 'default' });
    const whatsapp = '50235387468';
    const tema = 'emerald';

    if (!tenant) {
        tenant = await createTenantWithAccountNumber({
            slug: 'default',
            nombre: 'Catálogo de Productos',
            descripcion: 'Selecciona tus productos y confirma tu pedido.',
            whatsapp,
            adminAccessKey: crearAdminAccessKey(),
            activo: true,
            status: 'trial',
            trialStartDate: new Date(),
            billingDay: new Date().getDate()
        });
    } else if (!tenant.adminAccessKey) {
        tenant.adminAccessKey = crearAdminAccessKey();
        await tenant.save();
    }

    await ensureTenantBillingDefaults(tenant);

    await Settings.updateOne(
        { tenantId: tenant._id },
        {
            $setOnInsert: {
                tenantId: tenant._id,
                whatsapp,
                tema,
                logo: tenant.logo || '',
                logoShape: 'rectangle',
                catalogTitle: 'Catalogo de productos',
                colorPrimario: tenant.colorPrimario || '#10b981',
                mostrarBuscador: true,
                mostrarCategorias: true,
                mostrarDescripcion: false,
                vistaPredeterminada: 'grid',
                monedaVisible: 'GTQ',
                orderCartEnabled: true,
                orderWhatsappEnabled: true,
                addressRequirement: 'optional',
                commentRequirement: 'optional'
            }
        },
        { upsert: true }
    );

    for (const categoria of CATEGORIAS_DEFAULT) {
        await Category.updateOne(
            { tenantId: tenant._id, nombre: categoria.nombre },
            { $setOnInsert: { ...categoria, tenantId: tenant._id } },
            { upsert: true }
        );
    }

    const categorias = await Category.find({ tenantId: tenant._id });
    const porNombre = new Map(categorias.map(cat => [normalizarCategoria(cat.nombre), cat]));
    const categoriaFallback = porNombre.get('otros') || categorias[0];
    const productosSinTenant = await Producto.find({ tenantId: { $exists: false } });

    for (const producto of productosSinTenant) {
        const categoria = porNombre.get(normalizarCategoria(producto.categoria)) || categoriaFallback;
        producto.tenantId = tenant._id;
        producto.categoriaId = categoria?._id;
        producto.unidadMedida = producto.unidadMedida || producto.unidad;
        producto.imagenUrl = producto.imagenUrl || producto.imagen || '/uploads/placeholder.webp';
        producto.ordenVisualizacion = producto.ordenVisualizacion ?? producto.orden ?? 999;
        await producto.save();
    }

    await Pedido.updateMany(
        { tenantId: { $exists: false } },
        { $set: { tenantId: tenant._id } }
    );

    const adminExistente = await User.findOne({ tenantId: tenant._id });
    if (!adminExistente) {
        const adminPassword = process.env.DEFAULT_TENANT_ADMIN_PASSWORD || '';
        if (!adminPassword) {
            throw new Error('DEFAULT_TENANT_ADMIN_PASSWORD es obligatorio al crear el tenant inicial en produccion.');
        }
        await User.create({
            tenantId: tenant._id,
            nombre: process.env.DEFAULT_TENANT_ADMIN_NAME || 'Administrador',
            email: process.env.DEFAULT_TENANT_ADMIN_EMAIL || 'admin@example.com',
            usuario: (process.env.DEFAULT_TENANT_ADMIN_USER || 'admin').toLowerCase().trim(),
            passwordHash: await bcrypt.hash(adminPassword, 12),
            rol: 'tenant_admin',
            activo: true
        });
        console.log('Usuario admin inicial creado: admin / contraseña de configuración anterior.');
    }

    await User.updateMany(
        { tenantId: tenant._id, rol: { $in: ['owner', 'admin'] } },
        { $set: { rol: 'tenant_admin' } }
    );
}

async function asegurarSuperAdminBootstrap() {
    const tenant = await tenantDefault();
    if (!tenant) return;

    const existing = await User.findOne({ rol: 'super_admin' });
    if (existing) return;

    const usuario = (process.env.SUPER_ADMIN_USER || '').toLowerCase().trim();
    const email = (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();
    const password = process.env.SUPER_ADMIN_PASSWORD || '';

    if (!usuario || !email || !password) {
        throw new Error('SUPER_ADMIN_USER, SUPER_ADMIN_EMAIL y SUPER_ADMIN_PASSWORD son obligatorios.');
    }

    await User.create({
        tenantId: tenant._id,
        nombre: process.env.SUPER_ADMIN_NAME || 'Super Administrador',
        email,
        usuario,
        passwordHash: await bcrypt.hash(password, 12),
        rol: 'super_admin',
        activo: true
    });
    console.log(`Usuario super_admin inicial creado: ${usuario}`);
}

async function inicializarBase() {
    await asegurarTenantDefault();
    await asegurarSuperAdminBootstrap();
    const purged = await purgeDeletedTenants();
    if (purged > 0) console.log(`Cuentas eliminadas purgadas definitivamente: ${purged}`);
}

async function tenantDefault() {
    return Tenant.findOne({ slug: 'default', activo: true });
}

async function tenantDefaultMiddleware(req, res, next) {
    try {
        const tenant = await tenantDefault();
        if (!tenant) {
            return res.status(404).json({ error: 'Catálogo no encontrado' });
        }
        req.tenant = tenant;
        req.tenantId = tenant._id;
        next();
    } catch (err) {
        res.status(500).json({ error: 'Error al cargar tenant default' });
    }
}

async function settingsTenant(tenant) {
    let settings = await Settings.findOne({ tenantId: tenant._id });
    if (!settings) {
        settings = await Settings.create({
            tenantId: tenant._id,
            whatsapp: tenant.whatsapp,
            colorPrimario: tenant.colorPrimario || '#10b981',
            logo: tenant.logo || '',
            theme: DEFAULT_TENANT_THEME,
            tema: 'emerald',
            mostrarBuscador: true,
            mostrarCategorias: true,
            mostrarDescripcion: false,
            vistaPredeterminada: 'grid',
            monedaVisible: 'GTQ'
        });
    }
    return settings;
}

async function requireAdminAuth(req, res, next) {
    try {
        const bearerToken = String(req.headers.authorization || '').startsWith('Bearer ')
            ? String(req.headers.authorization).slice(7).trim()
            : '';
        const token = req.cookies[cookieName(req.tenant.slug)] || bearerToken;
        if (!token) {
            return res.status(401).json({ error: 'Sesion requerida' });
        }

        const session = await Session.findOne({ tokenHash: sha256(token), tenantId: req.tenantId });
        const ahora = new Date();
        const ultimaActividad = session?.lastActivityAt || session?.creadoEn || session?.expiresAt;
        const sesionInactiva = ultimaActividad && (ahora.getTime() - new Date(ultimaActividad).getTime() > ADMIN_IDLE_TIMEOUT_MS);

        if (!session || session.expiresAt <= ahora || sesionInactiva) {
            if (session) await Session.deleteOne({ _id: session._id, tenantId: req.tenantId });
            res.clearCookie(cookieName(req.tenant.slug), clearCookieOptions());
            return res.status(401).json({ error: 'Sesion invalida o expirada' });
        }

        const user = await User.findOne({ _id: session.userId, tenantId: req.tenantId, activo: true });
        if (!user) {
            return res.status(401).json({ error: 'Usuario no autorizado' });
        }

        req.session = session;
        req.user = user;
        session.lastActivityAt = ahora;
        session.expiresAt = nuevaExpiracionSesion();
        await session.save();
        res.cookie(cookieName(req.tenant.slug), token, cookieOptions());
        next();
    } catch (err) {
        next(err);
    }
}

async function requireSuperAdminAuth(req, res, next) {
    try {
        const bearerToken = String(req.headers.authorization || '').startsWith('Bearer ')
            ? String(req.headers.authorization).slice(7).trim()
            : '';
        const token = req.cookies[SUPER_ADMIN_COOKIE] || bearerToken;
        if (!token) {
            return res.status(401).json({ error: 'Sesion super admin requerida' });
        }

        const session = await Session.findOne({ tokenHash: sha256(token) });
        const ahora = new Date();
        const ultimaActividad = session?.lastActivityAt || session?.creadoEn || session?.expiresAt;
        const sesionInactiva = ultimaActividad && (ahora.getTime() - new Date(ultimaActividad).getTime() > ADMIN_IDLE_TIMEOUT_MS);

        if (!session || session.expiresAt <= ahora || sesionInactiva) {
            if (session) await Session.deleteOne({ _id: session._id });
            res.clearCookie(SUPER_ADMIN_COOKIE, clearCookieOptions());
            return res.status(401).json({ error: 'Sesion invalida o expirada' });
        }

        const user = await User.findOne({ _id: session.userId, rol: 'super_admin', activo: true });
        if (!user) {
            return res.status(403).json({ error: 'Rol super_admin requerido' });
        }

        req.session = session;
        req.user = user;
        session.lastActivityAt = ahora;
        session.expiresAt = nuevaExpiracionSesion();
        await session.save();
        res.cookie(SUPER_ADMIN_COOKIE, token, superAdminCookieOptions());
        next();
    } catch (err) {
        next(err);
    }
}


// Crear archivo placeholder.webp si no existe
const placeholderPath = path.join(uploadsDir, 'placeholder.webp');
if (!fs.existsSync(placeholderPath)) {
    sharp({
        create: {
            width: 300,
            height: 300,
            channels: 4,
            background: { r: 241, g: 245, b: 249, alpha: 1 } // slate-100
        }
    })
    .webp()
    .toFile(placeholderPath)
    .then(() => console.log('Placeholder de imagen creado en /uploads/placeholder.webp'))
    .catch(err => console.error('Error creando imagen placeholder:', err));
}

// Función auxiliar para eliminar imágenes antiguas
function subirBufferCloudinary(buffer, tenantSlug) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: `catalogo-productos/${tenantSlug}`,
                resource_type: 'image',
                format: 'webp'
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        stream.end(buffer);
    });
}

async function guardarImagenProducto(file, tenantSlug) {
    if (!file) {
        return { url: '/uploads/placeholder.webp', publicId: '' };
    }

    const webpBuffer = await sharp(file.buffer)
        .webp({ quality: 80 })
        .toBuffer();

    if (cloudinaryEnabled) {
        const result = await subirBufferCloudinary(webpBuffer, tenantSlug);
        return { url: result.secure_url, publicId: result.public_id };
    }

    const nombreArchivo = `prod-${Date.now()}.webp`;
    const rutaDestino = path.join(uploadsDir, nombreArchivo);
    await fs.promises.writeFile(rutaDestino, webpBuffer);
    return { url: `/uploads/${nombreArchivo}`, publicId: '' };
}

async function guardarImagenCatalogo(file, tenantSlug) {
    if (!file) {
        return { url: '', publicId: '' };
    }

    const webpBuffer = await sharp(file.buffer)
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();

    if (cloudinaryEnabled) {
        const result = await subirBufferCloudinary(webpBuffer, `${tenantSlug}/branding`);
        return { url: result.secure_url, publicId: result.public_id };
    }

    const nombreArchivo = `logo-${tenantSlug}-${Date.now()}.webp`;
    const rutaDestino = path.join(uploadsDir, nombreArchivo);
    await fs.promises.writeFile(rutaDestino, webpBuffer);
    return { url: `/uploads/${nombreArchivo}`, publicId: '' };
}

async function guardarArchivoGeneral(file, folder, prefix) {
    if (!file) return { url: '', publicId: '' };

    if (cloudinaryEnabled) {
        const dataUri = `data:${file.mimetype || 'application/octet-stream'};base64,${file.buffer.toString('base64')}`;
        const result = await cloudinary.uploader.upload(dataUri, {
            folder,
            resource_type: 'auto'
        });
        return { url: result.secure_url, publicId: result.public_id };
    }

    const safeExt = path.extname(file.originalname || '').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12) || '.bin';
    const nombreArchivo = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safeExt}`;
    const rutaDestino = path.join(uploadsDir, nombreArchivo);
    await fs.promises.writeFile(rutaDestino, file.buffer);
    return { url: `/uploads/${nombreArchivo}`, publicId: '' };
}

async function guardarLogoSaas(file) {
    if (!file) return { url: '', publicId: '' };
    const webpBuffer = await sharp(file.buffer)
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 84 })
        .toBuffer();

    if (cloudinaryEnabled) {
        const result = await subirBufferCloudinary(webpBuffer, 'saas/branding');
        return { url: result.secure_url, publicId: result.public_id };
    }

    const nombreArchivo = `saas-logo-${Date.now()}.webp`;
    const rutaDestino = path.join(uploadsDir, nombreArchivo);
    await fs.promises.writeFile(rutaDestino, webpBuffer);
    return { url: `/uploads/${nombreArchivo}`, publicId: '' };
}

async function eliminarImagen(rutaImagen, publicId = '') {
    if (publicId && cloudinaryEnabled) {
        try {
            await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
        } catch (err) {
            console.error(`No se pudo eliminar la imagen en Cloudinary: ${publicId}`, err);
        }
        return;
    }

    if (!rutaImagen || rutaImagen === '/uploads/placeholder.webp' || !rutaImagen.startsWith('/uploads/')) {
        return;
    }
    const rutaAbsoluta = path.resolve(__dirname, '.' + rutaImagen);
    if (!rutaAbsoluta.startsWith(uploadsDir)) {
        console.warn(`Intento de path traversal detectado: ${rutaImagen}`);
        return;
    }
    fs.unlink(rutaAbsoluta, (err) => {
        if (err) console.error(`No se pudo eliminar la imagen antigua: ${rutaAbsoluta}`, err);
        else console.log(`Imagen antigua eliminada: ${rutaAbsoluta}`);
    });
}

/* ==========================================================================
   RUTAS DE LA API - SEGURIDAD Y CONFIGURACIÓN
   ========================================================================== */



// Obtener configuración pública (tema visual y teléfono WhatsApp)
app.get('/api/config', async (req, res) => {
    try {
        const tenant = await tenantDefault();
        const settings = await settingsTenant(tenant);
        res.json({ 
            tema: settings.tema,
            telefonoWhatsApp: settings.whatsapp,
            whatsapp: settings.whatsapp,
            colorPrimario: settings.colorPrimario,
            logo: settings.logo,
            logoShape: settings.logoShape || 'rectangle',
            catalogTitle: settings.catalogTitle || 'Catalogo de productos'
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener la configuración pública' });
    }
});

// Configuración legacy protegida para compatibilidad con el tenant default.
app.get('/api/admin/config', tenantDefaultMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const settings = await settingsTenant(req.tenant);
        res.json({
            tema: settings.tema || 'lime',
            telefonoWhatsApp: settings.whatsapp || '',
            whatsapp: settings.whatsapp || '',
            colorPrimario: settings.colorPrimario || req.tenant.colorPrimario,
            logo: settings.logo || req.tenant.logo,
            logoShape: settings.logoShape || 'rectangle',
            catalogTitle: settings.catalogTitle || 'Catalogo de productos',
            nombreNegocio: settings.nombreNegocio || req.tenant.nombre,
            descripcionNegocio: settings.descripcionNegocio || ''
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener la configuración' });
    }
});

// Modificar configuración legacy del tenant default.
app.put('/api/admin/config', tenantDefaultMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const { tema, telefonoWhatsApp, whatsapp, colorPrimario, logo, logoShape, catalogTitle, nombreNegocio, descripcionNegocio } = req.body;
        const settings = await settingsTenant(req.tenant);
        if (tema) settings.tema = tema;
        if (telefonoWhatsApp || whatsapp) settings.whatsapp = telefonoWhatsApp || whatsapp;
        if (colorPrimario) settings.colorPrimario = colorPrimario;
        if (logo) settings.logo = logo;
        if (logoShape) settings.logoShape = logoShape;
        if (catalogTitle !== undefined) settings.catalogTitle = String(catalogTitle).trim() || settings.catalogTitle;
        if (nombreNegocio) settings.nombreNegocio = nombreNegocio;
        if (descripcionNegocio !== undefined) settings.descripcionNegocio = descripcionNegocio;
        await settings.save();
        res.json({ success: true, mensaje: 'Ajustes actualizados correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar ajustes' });
    }
});

const supportTicketSchema = z.object({
    name: z.string().trim().min(2).max(100),
    email: z.preprocess(
        value => typeof value === 'string' && value.trim() === '' ? undefined : value,
        z.string().trim().email().max(160).optional()
    ),
    whatsapp: z.string().trim().min(8).max(30),
    message: z.string().trim().min(10).max(2000)
});

app.post('/api/support/tickets', supportLimiter, async (req, res) => {
    try {
        const data = supportTicketSchema.parse(req.body);
        const ticket = await SupportTicket.create({
            name: data.name,
            email: data.email?.toLowerCase() || null,
            whatsapp: data.whatsapp,
            message: data.message,
            status: 'open'
        });
        res.status(201).json({
            success: true,
            message: 'Solicitud de soporte enviada correctamente.',
            ticketId: ticket._id
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Revisa los datos de la solicitud de soporte.' });
        }
        console.error('Error creando ticket de soporte:', error);
        res.status(500).json({ error: 'No se pudo enviar la solicitud de soporte.' });
    }
});

/* ==========================================================================
   RUTAS SUPER ADMIN - CONTROL DEL SAAS
   ========================================================================== */

const superAdminLoginSchema = z.object({
    identifier: z.string().trim().min(1),
    password: z.string().min(1)
});

app.post('/api/super-admin/auth/login', authLimiter, async (req, res) => {
    try {
        const { identifier, password } = superAdminLoginSchema.parse(req.body);
        const normalized = normalizeIdentifier(identifier);
        const user = await findUserByIdentifier(normalized, { role: 'super_admin' });

        if (user?.lockedUntil && user.lockedUntil > new Date()) {
            await auditLog(req, 'super_admin_login_blocked', { tenantId: user.tenantId, userId: user._id });
            return res.status(423).json({ error: 'Cuenta bloqueada temporalmente. Intenta mas tarde.' });
        }

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            if (user) {
                user.failedLoginAttempts += 1;
                if (user.failedLoginAttempts >= 5) {
                    user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
                }
                await user.save();
            }
            await auditLog(req, 'super_admin_login_failed', {
                tenantId: user?.tenantId,
                identifier: normalized,
                userId: user?._id
            });
            return res.status(401).json({ error: 'Credenciales invalidas' });
        }

        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        user.ultimoLogin = new Date();
        await user.save();
        req.user = user;
        req.tenantId = user.tenantId;
        await auditLog(req, 'super_admin_login_success', { tenantId: user.tenantId, userId: user._id });

        const token = crearTokenSeguro();
        await Session.create({
            tenantId: user.tenantId,
            userId: user._id,
            tokenHash: sha256(token),
            expiresAt: nuevaExpiracionSesion(),
            lastActivityAt: new Date(),
            ip: req.ip,
            userAgent: req.get('user-agent') || ''
        });

        res.cookie(SUPER_ADMIN_COOKIE, token, superAdminCookieOptions());
        const response = {
            success: true,
            user: {
                nombre: user.nombre,
                email: user.email,
                usuario: user.usuario,
                rol: user.rol
            }
        };
        if (process.env.NODE_ENV !== 'production') {
            response.devSessionToken = token;
        }
        res.json(response);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos invalidos' });
        }
        res.status(500).json({ error: 'Error en autenticacion super admin' });
    }
});

app.get('/api/super-admin/auth/me', requireSuperAdminAuth, async (req, res) => {
    res.json({
        user: {
            nombre: req.user.nombre,
            email: req.user.email,
            usuario: req.user.usuario,
            rol: req.user.rol
        }
    });
});

app.post('/api/super-admin/auth/logout', requireSuperAdminAuth, async (req, res) => {
    await Session.deleteOne({ _id: req.session._id });
    res.clearCookie(SUPER_ADMIN_COOKIE, clearCookieOptions());
    res.json({ success: true });
});

app.put('/api/super-admin/auth/password', requireSuperAdminAuth, async (req, res) => {
    try {
        const currentPassword = String(req.body.currentPassword || '');
        const newPassword = String(req.body.newPassword || '');
        if (!currentPassword || newPassword.length < 8) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
        }
        const hasUppercase = /[A-Z]/.test(newPassword);
        const hasNumber = /[0-9]/.test(newPassword);
        if (!hasUppercase || !hasNumber) {
            return res.status(400).json({ error: 'La nueva contraseña debe incluir al menos una mayúscula y un número.' });
        }
        
        const validPassword = await bcrypt.compare(currentPassword, req.user.passwordHash);
        if (!validPassword) {
            return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
        }
        
        req.user.passwordHash = await bcrypt.hash(newPassword, 12);
        await req.user.save();
        res.json({ success: true, message: 'Contraseña cambiada exitosamente' });
    } catch (err) {
        console.error('Error al cambiar contraseña de superadmin:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/api/super-admin/users', requireSuperAdminAuth, async (req, res) => {
    try {
        const users = await User.find({ rol: 'super_admin' }).sort({ creadoEn: -1 });
        res.json(users.map(u => ({
            id: u._id,
            nombre: u.nombre,
            email: u.email,
            usuario: u.usuario,
            activo: u.activo,
            creadoEn: u.creadoEn
        })));
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener usuarios administradores' });
    }
});

app.post('/api/super-admin/users', requireSuperAdminAuth, async (req, res) => {
    try {
        const { nombre, email, usuario, password } = req.body;
        if (!nombre || !email || !usuario || !password || password.length < 8) {
            return res.status(400).json({ error: 'Datos de usuario inválidos o contraseña menor a 8 caracteres' });
        }
        const tenant = await Tenant.findOne({ slug: 'default' });
        if (!tenant) return res.status(500).json({ error: 'Tenant default no encontrado' });
        
        const existing = await User.findOne({ 
            $or: [
                { email: email.toLowerCase().trim() }, 
                { usuario: usuario.toLowerCase().trim() }
            ]
        });
        if (existing) {
            return res.status(409).json({ error: 'El nombre de usuario o correo ya está registrado' });
        }
        
        const newUser = await User.create({
            tenantId: tenant._id,
            nombre,
            email: email.toLowerCase().trim(),
            usuario: usuario.toLowerCase().trim(),
            passwordHash: await bcrypt.hash(password, 12),
            rol: 'super_admin',
            activo: true
        });
        
        res.status(201).json({
            id: newUser._id,
            nombre: newUser.nombre,
            email: newUser.email,
            usuario: newUser.usuario,
            activo: newUser.activo,
            creadoEn: newUser.creadoEn
        });
    } catch (err) {
        console.error('Error creando usuario super admin:', err);
        res.status(500).json({ error: 'Error al crear usuario administrador' });
    }
});

app.delete('/api/super-admin/users/:id', requireSuperAdminAuth, async (req, res) => {
    try {
        if (String(req.user._id) === String(req.params.id)) {
            return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
        }
        const deleted = await User.deleteOne({ _id: req.params.id, rol: 'super_admin' });
        if (deleted.deletedCount === 0) {
            return res.status(404).json({ error: 'Usuario administrador no encontrado' });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar usuario administrador' });
    }
});

app.get('/api/saas/settings', async (req, res) => {
    try {
        res.json(saasSettingsPayload(await saasSettings()));
    } catch (err) {
        res.status(500).json({ error: 'Error al cargar configuracion del SaaS' });
    }
});

app.get('/api/super-admin/settings', requireSuperAdminAuth, async (req, res) => {
    try {
        res.json(saasSettingsPayload(await saasSettings()));
    } catch (err) {
        res.status(500).json({ error: 'Error al cargar configuracion del SaaS' });
    }
});

const saasSettingsSchema = z.object({
    supportWhatsapp: z.string().trim().max(30).optional(),
    supportMessage: z.string().trim().max(180).optional(),
    emulatorUrl: z.string().trim().max(300).optional(),
    emulatorEnabled: z.boolean().optional(),
    monthlyPrice: z.number().min(0).max(1000000).optional(),
    freeTrialDays: z.number().min(0).max(365).optional(),
    logoAltText: z.string().trim().max(100).optional(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    showPrice: z.boolean().optional(),
    
    // New fields
    platformName: z.string().trim().max(100).optional(),
    supportEmail: z.string().trim().max(100).optional(),
    supportUrl: z.string().trim().max(300).optional(),
    timezone: z.string().trim().max(100).optional(),
    currency: z.string().trim().max(10).optional(),
    faviconUrl: z.string().trim().max(300).optional(),
    landingHeroText: z.string().trim().max(1000).optional(),
    landingTitle: z.string().trim().max(200).optional(),
    landingSubtitle: z.string().trim().max(200).optional(),
    landingFaqs: z.string().trim().optional(),
    notificationEmails: z.boolean().optional(),
    notificationPaymentReminders: z.boolean().optional(),
    notificationUpcomingExpirations: z.boolean().optional(),
    notificationWelcomeMessages: z.boolean().optional()
});

app.patch('/api/super-admin/settings', requireSuperAdminAuth, async (req, res) => {
    try {
        const data = saasSettingsSchema.parse(req.body);
        const settings = await saasSettings();
        if (data.supportWhatsapp !== undefined) settings.supportWhatsapp = data.supportWhatsapp.replace(/\D/g, '');
        if (data.supportMessage !== undefined) settings.supportMessage = data.supportMessage;
        if (data.emulatorUrl !== undefined) settings.emulatorUrl = data.emulatorUrl;
        if (data.emulatorEnabled !== undefined) settings.emulatorEnabled = data.emulatorEnabled;
        if (data.monthlyPrice !== undefined) settings.monthlyPrice = data.monthlyPrice;
        if (data.freeTrialDays !== undefined) settings.freeTrialDays = data.freeTrialDays;
        if (data.logoAltText !== undefined) settings.logoAltText = data.logoAltText;
        if (data.primaryColor !== undefined) settings.primaryColor = data.primaryColor;
        if (data.secondaryColor !== undefined) settings.secondaryColor = data.secondaryColor;
        if (data.accentColor !== undefined) settings.accentColor = data.accentColor;
        if (data.showPrice !== undefined) settings.showPrice = data.showPrice;
        
        // New fields
        if (data.platformName !== undefined) settings.platformName = data.platformName;
        if (data.supportEmail !== undefined) settings.supportEmail = data.supportEmail;
        if (data.supportUrl !== undefined) settings.supportUrl = data.supportUrl;
        if (data.timezone !== undefined) settings.timezone = data.timezone;
        if (data.currency !== undefined) settings.currency = data.currency;
        if (data.faviconUrl !== undefined) settings.faviconUrl = data.faviconUrl;
        if (data.landingHeroText !== undefined) settings.landingHeroText = data.landingHeroText;
        if (data.landingTitle !== undefined) settings.landingTitle = data.landingTitle;
        if (data.landingSubtitle !== undefined) settings.landingSubtitle = data.landingSubtitle;
        if (data.landingFaqs !== undefined) settings.landingFaqs = data.landingFaqs;
        if (data.notificationEmails !== undefined) settings.notificationEmails = data.notificationEmails;
        if (data.notificationPaymentReminders !== undefined) settings.notificationPaymentReminders = data.notificationPaymentReminders;
        if (data.notificationUpcomingExpirations !== undefined) settings.notificationUpcomingExpirations = data.notificationUpcomingExpirations;
        if (data.notificationWelcomeMessages !== undefined) settings.notificationWelcomeMessages = data.notificationWelcomeMessages;

        await settings.save();
        res.json(saasSettingsPayload(settings));
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ error: 'Configuracion invalida', detalles: err.issues });
        res.status(500).json({ error: 'Error al guardar configuracion del SaaS' });
    }
});

app.post('/api/super-admin/settings/logo', requireSuperAdminAuth, upload.single('logo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Selecciona un logo' });
        const settings = await saasSettings();
        if (settings.logoUrl) {
            await eliminarImagen(settings.logoUrl, settings.logoCloudinaryPublicId);
        }
        const logo = await guardarLogoSaas(req.file);
        settings.logoUrl = logo.url;
        settings.logoCloudinaryPublicId = logo.publicId;
        await settings.save();
        res.json(saasSettingsPayload(settings));
    } catch (err) {
        console.error('Error guardando logo SaaS:', err);
        res.status(500).json({ error: 'Error al guardar logo del SaaS' });
    }
});

app.get('/api/super-admin/dashboard', requireSuperAdminAuth, async (req, res) => {
    try {
        const tenants = await Tenant.find({});
        await applyAccountTransitions(tenants);
        const byStatus = Object.fromEntries(ACCOUNT_STATUSES.map(status => [status, 0]));
        for (const tenant of tenants) {
            const status = tenant.status || 'trial';
            byStatus[status] = (byStatus[status] || 0) + 1;
        }
        const now = new Date();
        const nextWeek = addDays(now, 7);
        const thirtyDaysAgo = addDays(now, -30);
        const activeTenants = tenants.filter(tenant => tenant.status === 'active');
        const mrr = activeTenants.reduce((sum, tenant) => sum + money(tenant.monthlyPrice), 0);
        const upcomingExpirations = tenants.filter(tenant => {
            if (!['trial', 'active', 'pending_payment'].includes(tenant.status)) return false;
            const target = tenant.status === 'trial' ? tenant.trialEndDate : (tenant.paymentDueDate || tenant.currentPeriodEnd);
            return target && new Date(target) >= now && new Date(target) <= nextWeek;
        }).length;
        const deletedLast30Days = tenants.filter(tenant => (
            tenant.status === 'deleted' &&
            tenant.deletedAt &&
            new Date(tenant.deletedAt) >= thirtyDaysAgo
        )).length;
        const baseForChurn = Math.max(1, tenants.filter(tenant => (
            !tenant.creadoEn || new Date(tenant.creadoEn) < thirtyDaysAgo
        )).length);
        const openSupportTickets = await SupportTicket.countDocuments({ status: { $ne: 'closed' } });
        res.json({
            clientesActivos: byStatus.active,
            clientesPruebaGratis: byStatus.trial,
            pagosPendientes: byStatus.pending_payment,
            cuentasSuspendidas: byStatus.suspended,
            cuentasEliminadas: byStatus.deleted,
            proximasAVencer: upcomingExpirations,
            mrr,
            churn: Math.round((deletedLast30Days / baseForChurn) * 10000) / 100,
            ticketsAbiertos: openSupportTickets,
            byStatus
        });
    } catch (err) {
        console.error('Error cargando dashboard super admin:', err);
        res.status(500).json({ error: 'Error al cargar dashboard super admin' });
    }
});

app.get('/api/super-admin/tenants', requireSuperAdminAuth, async (req, res) => {
    try {
        const status = String(req.query.status || '').trim();
        const query = ACCOUNT_STATUSES.includes(status)
            ? { status }
            : { status: { $ne: 'deleted' } };
        const tenants = await Tenant.find(query).populate('planId').sort({ creadoEn: -1 });
        await applyAccountTransitions(tenants);
        res.json(await Promise.all(tenants.map(serializeTenantForSuperAdmin)));
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
});

app.get('/api/super-admin/billing', requireSuperAdminAuth, async (req, res) => {
    try {
        const tenants = await Tenant.find({ status: { $ne: 'deleted' } }).populate('planId').sort({ paymentDueDate: 1 });
        await applyAccountTransitions(tenants);
        const today = startOfDay();
        const tomorrow = addDays(today, 1);
        const weekEnd = addDays(today, 7);
        const groups = { dueToday: [], dueTomorrow: [], dueThisWeek: [], overdue: [] };

        for (const tenant of tenants) {
            const dueDate = tenant.status === 'trial'
                ? tenant.trialEndDate
                : (tenant.paymentDueDate || tenant.currentPeriodEnd);
            if (!dueDate) continue;
            const due = startOfDay(dueDate);
            const payload = await serializeTenantForSuperAdmin(tenant);
            if (due < today) groups.overdue.push(payload);
            else if (due.getTime() === today.getTime()) groups.dueToday.push(payload);
            else if (due.getTime() === tomorrow.getTime()) groups.dueTomorrow.push(payload);
            else if (due <= weekEnd) groups.dueThisWeek.push(payload);
        }
        res.json(groups);
    } catch (error) {
        res.status(500).json({ error: 'Error al cargar centro de cobros' });
    }
});

app.get('/api/super-admin/logs', requireSuperAdminAuth, async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 250);
        const logs = await prisma.auditLog.findMany({
            orderBy: { fecha: 'desc' },
            take: limit,
            include: {
                user: { select: { nombre: true, email: true, usuario: true } },
                tenant: { select: { accountNumber: true, nombre: true, slug: true } }
            }
        });
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: 'Error al cargar logs' });
    }
});

app.get('/api/super-admin/support/tickets', requireSuperAdminAuth, async (req, res) => {
    try {
        const status = String(req.query.status || '').trim();
        const query = SUPPORT_TICKET_STATUSES.includes(status) ? { status } : {};
        const tickets = await SupportTicket.find(query).sort({ createdAt: -1 });
        const openCount = await SupportTicket.countDocuments({ status: { $ne: 'closed' } });
        res.json({ tickets, openCount });
    } catch (error) {
        res.status(500).json({ error: 'Error al cargar solicitudes de soporte' });
    }
});

app.patch('/api/super-admin/support/tickets/:id', requireSuperAdminAuth, async (req, res) => {
    try {
        const status = String(req.body.status || '').trim();
        if (!SUPPORT_TICKET_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'Estado de ticket invalido' });
        }
        const ticket = await SupportTicket.findOne({ _id: req.params.id });
        if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
        ticket.status = status;
        await ticket.save();
        await auditLog(req, 'support_ticket_status_changed', { ticketId: ticket._id, status });
        res.json(ticket);
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar ticket' });
    }
});

app.get('/api/super-admin/trash', requireSuperAdminAuth, async (req, res) => {
    try {
        const tenants = await Tenant.find({ status: 'deleted' }).populate('planId').sort({ deletedAt: -1 });
        res.json(await Promise.all(tenants.map(serializeTenantForSuperAdmin)));
    } catch (err) {
        res.status(500).json({ error: 'Error al cargar papelera' });
    }
});

app.delete('/api/super-admin/trash/:id', requireSuperAdminAuth, async (req, res) => {
    try {
        const tenant = await Tenant.findOne({ _id: req.params.id, status: 'deleted' });
        if (!tenant) return res.status(404).json({ error: 'Cuenta no encontrada en trash' });
        await Promise.allSettled([
            Category.deleteMany({ tenantId: tenant._id }),
            Producto.deleteMany({ tenantId: tenant._id }),
            Settings.deleteOne({ tenantId: tenant._id }),
            Pedido.deleteMany({ tenantId: tenant._id }),
            User.deleteMany({ tenantId: tenant._id, rol: { $ne: 'super_admin' } }),
            Session.deleteMany({ tenantId: tenant._id }),
            Payment.deleteMany({ tenantId: tenant._id }),
            AccountStatusLog.deleteMany({ tenantId: tenant._id })
        ]);
        await Tenant.deleteOne({ _id: tenant._id });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar definitivamente' });
    }
});

app.get('/api/super-admin/tenants/:id', requireSuperAdminAuth, async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.params.id).populate('planId');
        if (!tenant) return res.status(404).json({ error: 'Cliente no encontrado' });
        await applyAccountTransitions(tenant);
        const thirtyDaysAgo = addDays(new Date(), -30);
        const [payments, logs, productCount, orderCount, sales30Days] = await Promise.all([
            Payment.find({ tenantId: tenant._id }).sort({ createdAt: -1 }).populate('approvedBy', 'nombre email usuario'),
            AccountStatusLog.find({ tenantId: tenant._id }).sort({ createdAt: -1 }).populate('changedBy', 'nombre email usuario'),
            Producto.countDocuments({ tenantId: tenant._id }),
            Pedido.countDocuments({ tenantId: tenant._id }),
            prisma.order.aggregate({
                where: { tenantId: tenant._id, fecha: { gte: thirtyDaysAgo } },
                _sum: { total: true }
            })
        ]);
        res.json({
            tenant: await serializeTenantForSuperAdmin(tenant),
            payments,
            statusLogs: logs,
            suspensionLogs: logs.filter(log => log.newStatus === 'suspended' || log.previousStatus === 'suspended'),
            receipts: payments.filter(payment => payment.receiptUrl),
            stats: {
                products: productCount,
                orders: orderCount,
                sales30Days: money(sales30Days._sum.total || 0)
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener detalle del cliente' });
    }
});

app.patch('/api/super-admin/tenants/:id/notes', requireSuperAdminAuth, async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ error: 'Cliente no encontrado' });
        tenant.internalNotes = String(req.body.notes || '').trim().slice(0, 5000);
        await tenant.save();
        await auditLog(req, 'tenant_internal_notes_updated', {
            tenantId: tenant._id,
            targetTenantId: tenant._id
        });
        res.json({ success: true, notes: tenant.internalNotes });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar notas internas' });
    }
});

const statusUpdateSchema = z.object({
    status: z.enum(['trial', 'active', 'pending_payment', 'suspended', 'deleted']),
    reason: z.string().trim().max(200).optional()
});

app.patch('/api/super-admin/tenants/:id/status', requireSuperAdminAuth, async (req, res) => {
    try {
        const data = statusUpdateSchema.parse(req.body);
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ error: 'Cliente no encontrado' });
        const previousStatus = tenant.status;
        tenant.status = data.status;
        tenant.activo = !['suspended', 'deleted'].includes(data.status);
        tenant.suspendedAt = data.status === 'suspended' ? new Date() : (data.status === 'active' ? null : tenant.suspendedAt);
        tenant.deletedAt = data.status === 'deleted' ? new Date() : (data.status !== 'deleted' ? null : tenant.deletedAt);
        if (data.status !== 'deleted') tenant.deletedReason = '';
        await tenant.save();
        await logAccountStatus(tenant, previousStatus, data.status, data.reason || 'Cambio manual super admin', req.user._id);
        res.json({ success: true, tenant: await serializeTenantForSuperAdmin(tenant) });
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ error: 'Estado invalido' });
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

const tenantPlanSchema = z.object({
    planId: z.string().trim().min(1),
    monthlyPrice: z.number().min(0).optional()
});

app.patch('/api/super-admin/tenants/:id/plan', requireSuperAdminAuth, async (req, res) => {
    try {
        const data = tenantPlanSchema.parse(req.body);
        const [tenant, plan] = await Promise.all([
            Tenant.findById(req.params.id),
            Plan.findById(data.planId)
        ]);
        if (!tenant || !plan) return res.status(404).json({ error: 'Cliente o plan no encontrado' });
        tenant.planId = plan._id;
        tenant.monthlyPrice = money(data.monthlyPrice ?? plan.monthlyPrice);
        tenant.trialEndDate = tenant.trialStartDate && plan.trialDays ? addDays(tenant.trialStartDate, plan.trialDays) : tenant.trialEndDate;
        if (!tenant.currentPeriodStart) tenant.currentPeriodStart = new Date();
        tenant.currentPeriodEnd = nextBillingDate(tenant.currentPeriodStart, tenant.billingDay || new Date().getDate());
        tenant.paymentDueDate = addDays(tenant.currentPeriodEnd, plan.graceDays || 0);
        await tenant.save();
        res.json({ success: true, tenant: await serializeTenantForSuperAdmin(tenant) });
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ error: 'Datos de plan invalidos' });
        res.status(500).json({ error: 'Error al cambiar plan' });
    }
});

const tenantPriceSchema = z.object({
    monthlyPrice: z.number().min(0)
});

app.patch('/api/super-admin/tenants/:id/price', requireSuperAdminAuth, async (req, res) => {
    try {
        const data = tenantPriceSchema.parse(req.body);
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ error: 'Cliente no encontrado' });
        tenant.monthlyPrice = money(data.monthlyPrice);
        await tenant.save();
        res.json({ success: true, tenant: await serializeTenantForSuperAdmin(tenant) });
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ error: 'Precio invalido' });
        res.status(500).json({ error: 'Error al cambiar precio' });
    }
});

const tenantTrialSchema = z.object({
    trialStartDate: z.coerce.date().optional(),
    trialEndDate: z.coerce.date().optional(),
    action: z.enum(['extend', 'finish']).optional(),
    days: z.number().int().min(1).optional()
});

app.patch('/api/super-admin/tenants/:id/trial', requireSuperAdminAuth, async (req, res) => {
    try {
        const data = tenantTrialSchema.parse(req.body);
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ error: 'Cliente no encontrado' });
        const previousStatus = tenant.status;
        if (data.trialStartDate) tenant.trialStartDate = data.trialStartDate;
        if (data.trialEndDate) tenant.trialEndDate = data.trialEndDate;
        if (data.action === 'extend') {
            tenant.trialEndDate = addDays(tenant.trialEndDate || new Date(), data.days || 1);
            tenant.status = 'trial';
            tenant.activo = true;
        }
        if (data.action === 'finish') {
            tenant.trialEndDate = new Date();
            tenant.status = 'pending_payment';
            tenant.activo = true;
        }
        await tenant.save();
        await logAccountStatus(tenant, previousStatus, tenant.status, 'Actualizacion de prueba gratis', req.user._id);
        res.json({ success: true, tenant: await serializeTenantForSuperAdmin(tenant) });
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ error: 'Datos de prueba invalidos' });
        res.status(500).json({ error: 'Error al actualizar prueba gratis' });
    }
});

const manualPaymentSchema = z.object({
    amount: z.number().min(0),
    paymentMonth: z.string().trim().min(1).max(40).optional(),
    paymentMethod: z.string().trim().max(60).optional()
});

app.post('/api/super-admin/tenants/:id/payments/confirm', requireSuperAdminAuth, async (req, res) => {
    try {
        const data = manualPaymentSchema.parse(req.body);
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ error: 'Cliente no encontrado' });

        const now = new Date();
        const payment = await Payment.create({
            tenantId: tenant._id,
            amount: money(data.amount),
            paymentMonth: data.paymentMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
            paymentMethod: data.paymentMethod || 'Efectivo',
            status: 'aprobado',
            paidAt: now,
            approvedAt: now,
            approvedById: req.user._id
        });

        const plan = tenant.planId ? await Plan.findById(tenant.planId) : null;
        tenant.lastPaymentAt = now;
        tenant.currentPeriodStart = now;
        tenant.currentPeriodEnd = nextBillingDate(now, tenant.billingDay || now.getDate());
        tenant.paymentDueDate = addDays(tenant.currentPeriodEnd, plan?.graceDays || 0);
        await tenant.save();
        await auditLog(req, 'payment_confirmed_manually', {
            tenantId: tenant._id,
            paymentId: payment._id
        });

        res.status(201).json({ success: true, payment, tenant: await serializeTenantForSuperAdmin(tenant) });
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ error: 'Datos de pago invalidos' });
        res.status(500).json({ error: 'Error al confirmar pago manual' });
    }
});

app.delete('/api/super-admin/tenants/:id', requireSuperAdminAuth, async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ error: 'Cliente no encontrado' });
        const previousStatus = tenant.status;
        tenant.status = 'deleted';
        tenant.activo = false;
        tenant.deletedAt = new Date();
        tenant.deletedReason = String(req.body?.reason || '').trim();
        await tenant.save();
        await logAccountStatus(tenant, previousStatus, 'deleted', tenant.deletedReason || 'Soft delete super admin', req.user._id);
        res.json({ success: true, tenant: await serializeTenantForSuperAdmin(tenant) });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar cuenta' });
    }
});

app.get('/api/super-admin/payments', requireSuperAdminAuth, async (req, res) => {
    try {
        const status = String(req.query.status || '').trim();
        const query = PAYMENT_STATUSES.includes(status) ? { status } : {};
        const payments = await Payment.find(query).sort({ createdAt: -1 }).populate('tenantId', 'nombre slug whatsapp email status').populate('approvedBy', 'nombre email usuario');
        res.json(payments.map(payment => ({
            id: payment._id,
            tenant: payment.tenantId,
            amount: payment.amount,
            paymentMonth: payment.paymentMonth,
            paymentMethod: payment.paymentMethod,
            receiptUrl: payment.receiptUrl,
            status: payment.status,
            paidAt: payment.paidAt,
            approvedAt: payment.approvedAt,
            approvedBy: payment.approvedBy,
            rejectionReason: payment.rejectionReason,
            createdAt: payment.createdAt
        })));
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener pagos' });
    }
});

app.patch('/api/super-admin/payments/:id/approve', requireSuperAdminAuth, async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id);
        if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
        if (payment.status === 'aprobado') {
            return res.status(409).json({ error: 'Este pago ya fue aprobado' });
        }
        const tenant = await Tenant.findById(payment.tenantId);
        if (!tenant) return res.status(404).json({ error: 'Cliente no encontrado' });
        payment.status = 'aprobado';
        payment.rejectionReason = '';
        payment.paidAt = payment.paidAt || new Date();
        payment.approvedAt = new Date();
        payment.approvedById = req.user._id;
        await payment.save();

        const plan = tenant.planId ? await Plan.findById(tenant.planId) : null;
        tenant.lastPaymentAt = payment.paidAt;
        tenant.currentPeriodStart = payment.paidAt;
        tenant.currentPeriodEnd = nextBillingDate(payment.paidAt, tenant.billingDay || payment.paidAt.getDate());
        tenant.paymentDueDate = addDays(tenant.currentPeriodEnd, plan?.graceDays || 0);
        await tenant.save();
        await auditLog(req, 'payment_approved', {
            tenantId: tenant._id,
            paymentId: payment._id
        });
        res.json({ success: true, payment, tenant: await serializeTenantForSuperAdmin(tenant) });
    } catch (err) {
        console.error('Error al aprobar pago:', err);
        res.status(500).json({ error: 'Error al aprobar pago' });
    }
});

app.patch('/api/super-admin/payments/:id/reject', requireSuperAdminAuth, async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id);
        if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
        const tenant = await Tenant.findById(payment.tenantId);
        payment.status = 'rechazado';
        payment.rejectionReason = String(req.body?.reason || '').trim();
        payment.approvedAt = null;
        payment.approvedById = null;
        await payment.save();
        if (tenant) {
            await auditLog(req, 'payment_rejected', {
                tenantId: tenant._id,
                paymentId: payment._id,
                reason: payment.rejectionReason
            });
        }
        res.json({ success: true, payment, tenant: tenant ? await serializeTenantForSuperAdmin(tenant) : null });
    } catch (err) {
        res.status(500).json({ error: 'Error al rechazar pago' });
    }
});

// ─── RESET CREDENTIALS (Super Admin) ─────────────────────────────────────────
app.post('/api/super-admin/tenants/:id/recovery', requireSuperAdminAuth, async (req, res) => {
    try {
        const method = String(req.body.method || '').trim();
        if (!['email', 'whatsapp_code', 'temporary_password'].includes(method)) {
            return res.status(400).json({ error: 'Metodo de recuperacion invalido' });
        }

        const tenant = await Tenant.findById(req.params.id);
        if (!tenant || tenant.status === 'deleted') {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }
        const user = await User.findOne({
            tenantId: tenant._id,
            activo: true,
            $or: [{ rol: 'owner' }, { rol: 'tenant_admin' }, { rol: 'admin' }]
        }).sort({ creadoEn: 1 });
        if (!user) return res.status(404).json({ error: 'Usuario principal no encontrado' });

        if (method === 'email') {
            const { resetUrl, emailStatus } = await createPasswordResetForUser(req, user, tenant);
            await auditLog(req, 'super_admin_recovery_email_created', {
                tenantId: tenant._id,
                targetUserId: user._id
            });
            return res.json({
                success: true,
                message: 'Enlace de recuperacion enviado por correo.',
                devResetUrl: emailStatus.dev && process.env.NODE_ENV !== 'production' ? resetUrl : undefined
            });
        }

        if (method === 'whatsapp_code') {
            await RecoveryCode.updateMany(
                { tenantId: tenant._id, userId: user._id, usedAt: null },
                { $set: { usedAt: new Date() } }
            );
            const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
            await RecoveryCode.create({
                tenantId: tenant._id,
                userId: user._id,
                codeHash: sha256(`${user._id}:${code}`),
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                createdBy: req.user._id,
                ip: req.ip,
                userAgent: req.get('user-agent') || ''
            });
            await auditLog(req, 'super_admin_recovery_code_created', {
                tenantId: tenant._id,
                targetUserId: user._id
            });
            return res.json({
                success: true,
                message: 'Codigo temporal generado. Se mostrara una sola vez.',
                code,
                expiresInMinutes: 10
            });
        }

        const temporaryPassword = `Tmp-${crypto.randomBytes(8).toString('base64url')}A1`;
        user.passwordHash = await bcrypt.hash(temporaryPassword, 12);
        user.mustChangePassword = true;
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        await user.save();
        await Session.deleteMany({ tenantId: tenant._id, userId: user._id });
        await auditLog(req, 'super_admin_temporary_password_created', {
            tenantId: tenant._id,
            targetUserId: user._id
        });
        res.json({
            success: true,
            message: 'Contrasena temporal generada. Se mostrara una sola vez.',
            temporaryPassword
        });
    } catch (error) {
        console.error('Error creando recuperacion manual:', error);
        res.status(500).json({ error: 'Error al preparar recuperacion de acceso' });
    }
});

app.post('/api/super-admin/tenants/:id/reset-credentials', requireSuperAdminAuth, async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ error: 'Cliente no encontrado' });

        const user = await User.findOne({ tenantId: tenant._id, activo: true, $or: [{ rol: 'owner' }, { rol: 'tenant_admin' }] })
            .sort({ creadoEn: 1 });
        if (!user) return res.status(404).json({ error: 'Usuario principal del cliente no encontrado' });

        const { newUsuario, newEmail, newPassword } = req.body;
        const changes = {};

        if (newUsuario) {
            const normalized = String(newUsuario).toLowerCase().trim();
            if (normalized.length < 3) return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres' });
            const existing = await User.findOne({ tenantId: tenant._id, usuario: normalized, _id: { $ne: user._id } });
            if (existing) return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso en esta cuenta' });
            user.usuario = normalized;
            changes.usuario = normalized;
        }

        if (newEmail) {
            const normalizedEmail = String(newEmail).toLowerCase().trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
                return res.status(400).json({ error: 'Formato de correo inválido' });
            }
            const existing = await User.findOne({ tenantId: tenant._id, email: normalizedEmail, _id: { $ne: user._id } });
            if (existing) return res.status(409).json({ error: 'Ese correo ya está en uso en esta cuenta' });
            user.email = normalizedEmail;
            changes.email = normalizedEmail;
        }

        if (newPassword) {
            if (String(newPassword).length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
            user.passwordHash = await bcrypt.hash(String(newPassword), 12);
            changes.password = '***';
        }

        if (Object.keys(changes).length === 0) {
            return res.status(400).json({ error: 'Indica al menos un campo a actualizar: newUsuario, newEmail o newPassword' });
        }

        user.mustChangePassword = Boolean(newPassword);
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        await user.save();
        if (newPassword) {
            await Session.deleteMany({ tenantId: tenant._id, userId: user._id });
        }

        await auditLog(req, 'super_admin_reset_credentials', {
            tenantId: tenant._id,
            tenantSlug: tenant.slug,
            targetUserId: user._id,
            changes: Object.keys(changes)
        });

        res.json({
            success: true,
            message: `Credenciales actualizadas. El cliente deberá cambiar su contraseña al ingresar.`,
            updatedFields: Object.keys(changes)
        });
    } catch (err) {
        console.error('Error resetting credentials:', err);
        res.status(500).json({ error: 'Error al resetear credenciales' });
    }
});

// ─── DELETE SINGLE PAYMENT (Super Admin) ─────────────────────────────────────
app.delete('/api/super-admin/payments/:id', requireSuperAdminAuth, async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id).populate('tenantId', 'slug nombre');
        if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });

        await auditLog(req, 'super_admin_delete_payment', {
            paymentId: payment._id,
            tenantId: payment.tenantId?._id,
            tenantSlug: payment.tenantId?.slug,
            amount: payment.amount,
            paymentMonth: payment.paymentMonth,
            status: payment.status
        });

        await Payment.deleteOne({ _id: payment._id });
        res.json({ success: true, message: 'Registro de pago eliminado correctamente' });
    } catch (err) {
        console.error('Error deleting payment:', err);
        res.status(500).json({ error: 'Error al eliminar pago' });
    }
});

app.get('/api/super-admin/plans', requireSuperAdminAuth, async (req, res) => {
    try {
        const plans = await Plan.find({}).sort({ createdAt: -1 });
        res.json(plans);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener planes' });
    }
});

const planSchema = z.object({
    name: z.string().trim().min(2).max(80),
    monthlyPrice: z.number().min(0),
    trialDays: z.number().int().min(0).default(0),
    graceDays: z.number().int().min(0).default(0),
    productLimit: z.number().int().min(0).nullable().optional(),
    features: z.array(z.string().trim().min(1).max(120)).default([]),
    isActive: z.boolean().default(true)
});

app.post('/api/super-admin/plans', requireSuperAdminAuth, async (req, res) => {
    try {
        const data = planSchema.parse(req.body);
        const plan = await Plan.create(data);
        res.status(201).json(plan);
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ error: 'Datos de plan invalidos' });
        res.status(500).json({ error: 'Error al crear plan' });
    }
});

app.patch('/api/super-admin/plans/:id', requireSuperAdminAuth, async (req, res) => {
    try {
        const partialSchema = planSchema.partial();
        const data = partialSchema.parse(req.body);
        const plan = await Plan.findByIdAndUpdate(req.params.id, { $set: data }, { new: true });
        if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
        res.json(plan);
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ error: 'Datos de plan invalidos' });
        res.status(500).json({ error: 'Error al actualizar plan' });
    }
});

app.get('/api/:tenant/settings', tenantMiddleware, async (req, res) => {
    try {
        await applyAccountTransitions(req.tenant);
        const settings = await settingsTenant(req.tenant);
        const plan = req.tenant.planId ? await Plan.findById(req.tenant.planId) : null;
        res.json({
            whatsapp: settings.whatsapp,
            telefonoWhatsApp: settings.whatsapp,
            colorPrimario: settings.colorPrimario,
            logo: settings.logo,
            logoShape: settings.logoShape || 'rectangle',
            catalogTitle: settings.catalogTitle || 'Catalogo de productos',
            tema: settings.tema,
            theme: normalizarThemeTenant(settings.theme),
            nombreNegocio: req.tenant.nombre,
            descripcionNegocio: req.tenant.descripcion || '',
            mostrarBuscador: settings.mostrarBuscador,
            mostrarCategorias: settings.mostrarCategorias,
            mostrarDescripcion: false,
            vistaPredeterminada: settings.vistaPredeterminada,
            monedaVisible: settings.monedaVisible,
            orderCartEnabled: settings.orderCartEnabled !== false,
            orderWhatsappEnabled: settings.orderWhatsappEnabled !== false,
            addressRequirement: settings.addressRequirement || 'optional',
            commentRequirement: settings.commentRequirement || 'optional',
            account: tenantBillingPayload(req.tenant, plan)
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener la configuración pública' });
    }
});

app.get('/api/:tenant/admin/settings', tenantMiddleware, requireAdminAuth, async (req, res) => {
    try {
        await applyAccountTransitions(req.tenant);
        const settings = await settingsTenant(req.tenant);
        const plan = req.tenant.planId ? await Plan.findById(req.tenant.planId) : null;
        res.json({
            whatsapp: settings.whatsapp,
            telefonoWhatsApp: settings.whatsapp,
            colorPrimario: settings.colorPrimario,
            logo: settings.logo,
            logoShape: settings.logoShape || 'rectangle',
            catalogTitle: settings.catalogTitle || 'Catalogo de productos',
            tema: settings.tema,
            theme: normalizarThemeTenant(settings.theme),
            nombreNegocio: req.tenant.nombre,
            descripcionNegocio: req.tenant.descripcion || '',
            mostrarBuscador: settings.mostrarBuscador,
            mostrarCategorias: settings.mostrarCategorias,
            mostrarDescripcion: false,
            vistaPredeterminada: settings.vistaPredeterminada,
            monedaVisible: settings.monedaVisible,
            orderCartEnabled: settings.orderCartEnabled !== false,
            orderWhatsappEnabled: settings.orderWhatsappEnabled !== false,
            addressRequirement: settings.addressRequirement || 'optional',
            commentRequirement: settings.commentRequirement || 'optional',
            account: tenantBillingPayload(req.tenant, plan)
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener la configuración del tenant' });
    }
});

app.put('/api/:tenant/admin/settings', tenantMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const {
            tema,
            telefonoWhatsApp,
            whatsapp,
            colorPrimario,
            logo,
            logoShape,
            catalogTitle,
            theme,
            nombreNegocio,
            descripcionNegocio,
            mostrarBuscador,
            mostrarCategorias,
            vistaPredeterminada,
            monedaVisible,
            orderCartEnabled,
            orderWhatsappEnabled,
            addressRequirement,
            commentRequirement
        } = req.body;
        const themeNormalizado = theme !== undefined ? normalizarThemeTenant(theme) : undefined;
        const validRequirement = (value) => ['optional', 'required', 'disabled'].includes(value) ? value : undefined;
        const nextOrderCartEnabled = orderCartEnabled !== undefined ? Boolean(orderCartEnabled) : undefined;
        const nextOrderWhatsappEnabled = orderWhatsappEnabled !== undefined ? Boolean(orderWhatsappEnabled) : undefined;
        const currentSettings = await settingsTenant(req.tenant);
        const finalOrderCartEnabled = nextOrderCartEnabled !== undefined ? nextOrderCartEnabled : currentSettings.orderCartEnabled !== false;
        const finalOrderWhatsappEnabled = nextOrderWhatsappEnabled !== undefined ? nextOrderWhatsappEnabled : currentSettings.orderWhatsappEnabled !== false;
        if (!finalOrderCartEnabled && !finalOrderWhatsappEnabled) {
            return res.status(400).json({ error: 'Debes mantener al menos una forma de recibir pedidos activa' });
        }

        const settingsUpdate = {
            ...(tema ? { tema } : {}),
            ...(telefonoWhatsApp || whatsapp ? { whatsapp: telefonoWhatsApp || whatsapp } : {}),
            ...(colorPrimario ? { colorPrimario } : {}),
            ...(logo !== undefined ? { logo } : {}),
            ...(logoShape ? { logoShape } : {}),
            ...(catalogTitle !== undefined ? { catalogTitle: String(catalogTitle).trim() || 'Catalogo de productos' } : {}),
            ...(themeNormalizado ? { theme: themeNormalizado } : {}),
            ...(mostrarBuscador !== undefined ? { mostrarBuscador: Boolean(mostrarBuscador) } : {}),
            ...(mostrarCategorias !== undefined ? { mostrarCategorias: Boolean(mostrarCategorias) } : {}),
            mostrarDescripcion: false,
            ...(vistaPredeterminada ? { vistaPredeterminada } : {}),
            ...(monedaVisible ? { monedaVisible } : {}),
            ...(nextOrderCartEnabled !== undefined ? { orderCartEnabled: nextOrderCartEnabled } : {}),
            ...(nextOrderWhatsappEnabled !== undefined ? { orderWhatsappEnabled: nextOrderWhatsappEnabled } : {}),
            ...(validRequirement(addressRequirement) ? { addressRequirement } : {}),
            ...(validRequirement(commentRequirement) ? { commentRequirement } : {})
        };

        const updatedSettings = await prisma.settings.upsert({
            where: { tenantId: req.tenantId },
            update: settingsUpdate,
            create: {
                tenantId: req.tenantId,
                whatsapp: telefonoWhatsApp || whatsapp || currentSettings.whatsapp || req.tenant.whatsapp,
                colorPrimario: colorPrimario || currentSettings.colorPrimario || req.tenant.colorPrimario || '#10b981',
                logo: logo !== undefined ? logo : currentSettings.logo || '',
                logoShape: logoShape || currentSettings.logoShape || 'rectangle',
                catalogTitle: catalogTitle !== undefined ? String(catalogTitle).trim() || 'Catalogo de productos' : currentSettings.catalogTitle || 'Catalogo de productos',
                tema: tema || currentSettings.tema || 'emerald',
                theme: themeNormalizado || currentSettings.theme || DEFAULT_TENANT_THEME,
                mostrarBuscador: mostrarBuscador !== undefined ? Boolean(mostrarBuscador) : currentSettings.mostrarBuscador !== false,
                mostrarCategorias: mostrarCategorias !== undefined ? Boolean(mostrarCategorias) : currentSettings.mostrarCategorias !== false,
                mostrarDescripcion: false,
                vistaPredeterminada: vistaPredeterminada || currentSettings.vistaPredeterminada || 'grid',
                monedaVisible: monedaVisible || currentSettings.monedaVisible || 'GTQ',
                orderCartEnabled: finalOrderCartEnabled,
                orderWhatsappEnabled: finalOrderWhatsappEnabled,
                addressRequirement: validRequirement(addressRequirement) || currentSettings.addressRequirement || 'optional',
                commentRequirement: validRequirement(commentRequirement) || currentSettings.commentRequirement || 'optional'
            }
        });

        if (telefonoWhatsApp || whatsapp || colorPrimario || logo !== undefined) {
            if (telefonoWhatsApp || whatsapp) req.tenant.whatsapp = telefonoWhatsApp || whatsapp;
            if (colorPrimario) req.tenant.colorPrimario = colorPrimario;
            if (logo !== undefined) req.tenant.logo = logo;
        }
        if (nombreNegocio !== undefined) req.tenant.nombre = String(nombreNegocio).trim() || req.tenant.nombre;
        if (descripcionNegocio !== undefined) req.tenant.descripcion = String(descripcionNegocio).trim();
        await req.tenant.save();

        res.json({
            success: true,
            mensaje: 'Ajustes del tenant actualizados correctamente',
            settings: {
                mostrarBuscador: updatedSettings.mostrarBuscador,
                mostrarCategorias: updatedSettings.mostrarCategorias,
                mostrarDescripcion: false,
                vistaPredeterminada: updatedSettings.vistaPredeterminada,
                monedaVisible: updatedSettings.monedaVisible,
                orderCartEnabled: updatedSettings.orderCartEnabled,
                orderWhatsappEnabled: updatedSettings.orderWhatsappEnabled,
                addressRequirement: updatedSettings.addressRequirement,
                commentRequirement: updatedSettings.commentRequirement
            }
        });
    } catch (err) {
        console.error('Error al actualizar ajustes del tenant:', err);
        res.status(500).json({ error: 'Error al actualizar ajustes del tenant' });
    }
});

app.post('/api/:tenant/admin/payments/receipt', tenantMiddleware, requireAdminAuth, upload.single('receipt'), async (req, res) => {
    try {
        const amount = money(req.body.amount || req.tenant.monthlyPrice || 0);
        const now = new Date();
        const paymentMonth = String(req.body.paymentMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`).trim();
        const paymentMethod = String(req.body.paymentMethod || 'Transferencia').trim() || 'Transferencia';
        const receipt = req.file
            ? await guardarArchivoGeneral(req.file, `${req.tenant.slug}/receipts`, `receipt-${req.tenant.slug}`)
            : { url: '', publicId: '' };
        let payment = await Payment.findOne({ tenantId: req.tenantId, paymentMonth, status: 'pendiente' }).sort({ createdAt: -1 });
        if (payment) {
            payment.amount = amount;
            payment.paymentMethod = paymentMethod;
            payment.paidAt = now;
            if (receipt.url) payment.receiptUrl = receipt.url;
            await payment.save();
        } else {
            payment = await Payment.create({
                tenantId: req.tenantId,
                amount,
                paymentMonth,
                paymentMethod,
                receiptUrl: receipt.url,
                status: 'pendiente',
                paidAt: now
            });
        }
        const previousStatus = req.tenant.status;
        req.tenant.status = 'pending_payment';
        req.tenant.activo = true; 
        await req.tenant.save();
        await logAccountStatus(req.tenant, previousStatus, 'pending_payment', 'Pago reportado por cliente en revision', req.user._id);
        res.status(201).json({ success: true, payment, account: tenantBillingPayload(req.tenant, req.tenant.planId ? await Plan.findById(req.tenant.planId) : null) });
    } catch (err) {
        console.error('Error subiendo comprobante:', err);
        res.status(500).json({ error: 'Error al subir comprobante' });
    }
});

app.get('/api/:tenant/admin/payments', tenantMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const payments = await Payment.find({ tenantId: req.tenantId }).sort({ createdAt: -1 }).populate('approvedBy', 'nombre email usuario');
        res.json(payments);
    } catch (err) {
        res.status(500).json({ error: 'Error al cargar historial de pagos' });
    }
});

app.post('/api/:tenant/admin/settings/logo', tenantMiddleware, requireAdminAuth, upload.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Selecciona una imagen para el logo' });
        }

        const settingsActuales = await Settings.findOne({ tenantId: req.tenantId });
        if (settingsActuales?.logo) {
            await eliminarImagen(settingsActuales.logo, settingsActuales.logoCloudinaryPublicId);
        }

        const logo = await guardarImagenCatalogo(req.file, req.tenant.slug);
        await Settings.updateOne(
            { tenantId: req.tenantId },
            { $set: { logo: logo.url, logoCloudinaryPublicId: logo.publicId }, $setOnInsert: { tenantId: req.tenantId } },
            { upsert: true }
        );

        req.tenant.logo = logo.url;
        await req.tenant.save();

        res.json({ success: true, logo: logo.url });
    } catch (err) {
        console.error('Error al subir logo del catálogo:', err);
        res.status(500).json({ error: 'Error al guardar el logo del catálogo' });
    }
});

/* ==========================================================================
   RUTAS DE LA API - PRODUCTOS
   ========================================================================== */

app.get('/api/tenant/:slug', async (req, res) => {
    try {
        const tenant = await Tenant.findOne({ slug: req.params.slug.toLowerCase().trim(), activo: true });
        if (!tenant) {
            return res.status(404).json({ error: 'Catalogo no encontrado' });
        }
        const settings = await settingsTenant(tenant);
        res.json({
            slug: tenant.slug,
            nombre: tenant.nombre,
            descripcion: tenant.descripcion || '',
            logo: tenant.logo,
            logoShape: settings.logoShape || 'rectangle',
            colorPrimario: tenant.colorPrimario,
            whatsapp: tenant.whatsapp,
            activo: tenant.activo
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener el catálogo' });
    }
});

const registerTenantSchema = z.object({
    nombre: z.string().trim().min(2).max(80),
    slug: z.string().trim().min(2).max(60).optional(),
    whatsapp: z.string().trim().min(8).max(20),
    usuario: z.string().trim().min(3).max(40),
    email: z.string().trim().email().optional(),
    password: z.string().min(8).max(100),
    tipoNegocio: z.string().trim().max(50).optional().default('personalizado')
});

app.post('/api/tenants/register', authLimiter, async (req, res) => {
    let tenantCreado = null;
    try {
        const data = registerTenantSchema.parse(req.body);
        const slug = normalizarSlug(data.slug || data.nombre);
        const usuario = data.usuario.toLowerCase().trim();
        const email = (data.email || `${usuario}@${slug}.local`).toLowerCase().trim();
        const whatsapp = data.whatsapp.replace(/\D/g, '');

        const reservedSlugs = ['admin', 'api', 'super-admin', 'health', 'uploads', 'default', 'c', 'p', 'auth', 'login', 'register'];
        if (!slug || reservedSlugs.includes(slug)) {
            return res.status(400).json({ error: 'Slug inválido o reservado para el negocio' });
        }
        if (whatsapp.length < 8) {
            return res.status(400).json({ error: 'WhatsApp inválido' });
        }

        const tenantExistente = await Tenant.findOne({ slug });
        if (tenantExistente) {
            const userExistente = await User.findOne({
                tenantId: tenantExistente._id,
                activo: true,
                $or: [{ usuario }, { email }]
            });
            const passwordCoincide = userExistente
                ? await bcrypt.compare(data.password, userExistente.passwordHash)
                : false;

            if (passwordCoincide) {
                return res.status(200).json({
                    success: true,
                    existingAccount: true,
                    tenant: {
                        accountNumber: tenantExistente.accountNumber,
                        slug: tenantExistente.slug,
                        nombre: tenantExistente.nombre,
                        tipoNegocio: tenantExistente.tipoNegocio
                    },
                    publicUrl: `/c/${tenantExistente.slug}`,
                    adminUrl: `/c/${tenantExistente.slug}/p/${tenantExistente.adminAccessKey}`
                });
            }

            return res.status(409).json({ error: 'Ese enlace de catálogo ya está en uso' });
        }

        tenantCreado = await createTenantWithAccountNumber({
            slug,
            nombre: data.nombre,
            descripcion: '',
            ownerName: 'Administrador',
            email,
            tipoNegocio: data.tipoNegocio,
            whatsapp,
            colorPrimario: '#10b981',
            adminAccessKey: crearAdminAccessKey(),
            activo: true,
            status: 'trial',
            trialStartDate: new Date(),
            billingDay: new Date().getDate()
        });

        await ensureTenantBillingDefaults(tenantCreado);

        await Settings.create({
            tenantId: tenantCreado._id,
            whatsapp,
            colorPrimario: tenantCreado.colorPrimario,
            logo: '',
            logoShape: 'rectangle',
            catalogTitle: 'Catalogo de productos',
            theme: DEFAULT_TENANT_THEME,
            tema: 'emerald',
            mostrarBuscador: true,
            mostrarCategorias: true,
            mostrarDescripcion: false,
            vistaPredeterminada: 'grid',
            monedaVisible: 'GTQ'
        });

        await User.create({
            tenantId: tenantCreado._id,
            nombre: 'Administrador',
            email,
            usuario,
            passwordHash: await bcrypt.hash(data.password, 12),
            rol: 'tenant_admin',
            activo: true
        });

        enviarEmailBienvenida({ to: email, tenant: tenantCreado, usuario })
            .catch(error => console.error('Error enviando bienvenida:', error.message));

        const categoriasIniciales = CATEGORIAS_POR_TIPO_NEGOCIO[data.tipoNegocio] || [];
        if (categoriasIniciales.length > 0) {
            await Category.insertMany(categoriasIniciales.map(cat => ({
                tenantId: tenantCreado._id,
                nombre: cat.nombre,
                orden: cat.orden
            })));
        }

        res.status(201).json({
            success: true,
            tenant: {
                accountNumber: tenantCreado.accountNumber,
                slug: tenantCreado.slug,
                nombre: tenantCreado.nombre,
                tipoNegocio: tenantCreado.tipoNegocio
            },
            publicUrl: `/c/${tenantCreado.slug}`,
            adminUrl: `/c/${tenantCreado.slug}/p/${tenantCreado.adminAccessKey}`
        });
    } catch (err) {
        if (tenantCreado?._id) {
            await Promise.allSettled([
                Category.deleteMany({ tenantId: tenantCreado._id }),
                Settings.deleteOne({ tenantId: tenantCreado._id }),
                User.deleteMany({ tenantId: tenantCreado._id }),
                Tenant.deleteOne({ _id: tenantCreado._id })
            ]);
        }
        if (err instanceof z.ZodError) {
            const fieldNames = {
                nombre: 'Nombre del negocio',
                slug: 'Enlace del catálogo',
                whatsapp: 'WhatsApp',
                usuario: 'Tu nombre',
                email: 'Correo',
                password: 'Contraseña',
                tipoNegocio: 'Tipo de negocio'
            };
            const details = err.issues.map(e => {
                const rawField = e.path.join('.');
                const field = fieldNames[rawField] || rawField;
                let msg = e.message;
                if (e.code === 'too_small') {
                    msg = `debe tener al menos ${e.minimum} caracteres`;
                } else if (e.code === 'too_big') {
                    msg = `debe tener un máximo de ${e.maximum} caracteres`;
                } else if ((e.code === 'invalid_string' && e.validation === 'email') || (e.code === 'invalid_format' && e.format === 'email')) {
                    msg = `debe ser un correo electrónico válido`;
                } else if (e.code === 'invalid_type') {
                    msg = `es requerido o tiene un formato inválido`;
                }
                return `${field} (${msg})`;
            }).join(', ');
            return res.status(400).json({ error: `Datos inválidos: ${details}` });
        }
        if (err.code === 11000) {
            return res.status(409).json({ error: 'El negocio o usuario ya existe' });
        }
        console.error('Error al registrar tenant:', err);
        res.status(500).json({ error: 'Error al crear la cuenta' });
    }
});

app.get('/api/:tenant/admin/access/:key', tenantMiddleware, async (req, res) => {
    try {
        const valido = req.tenant.adminAccessKey === req.params.key;
        if (!valido) {
            return res.status(404).json({ error: 'Panel no encontrado' });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error al validar acceso administrativo' });
    }
});

const loginSchema = z.object({
    identifier: z.string().trim().min(1),
    password: z.string().min(1)
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { identifier, password } = loginSchema.parse(req.body);
        const normalized = normalizeIdentifier(identifier);
        const user = await findUserByIdentifier(normalized);

        const genericError = { error: 'Credenciales inválidas' };
        if (!user) {
            return res.status(401).json(genericError);
        }

        const tenant = await Tenant.findById(user.tenantId);
        if (!tenant || !tenant.activo || tenant.status === 'deleted') {
            return res.status(401).json({ error: 'Catálogo no encontrado o inactivo' });
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
            return res.status(423).json({ error: 'Cuenta bloqueada temporalmente. Intenta más tarde.' });
        }

        const validPassword = await bcrypt.compare(password, user.passwordHash);
        if (!validPassword) {
            user.failedLoginAttempts += 1;
            if (user.failedLoginAttempts >= 5) {
                user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
            }
            await user.save();
            return res.status(401).json(genericError);
        }

        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        user.ultimoLogin = new Date();
        await user.save();

        const token = crearTokenSeguro();
        await Session.create({
            tenantId: tenant._id,
            userId: user._id,
            tokenHash: sha256(token),
            expiresAt: nuevaExpiracionSesion(),
            lastActivityAt: new Date(),
            ip: req.ip,
            userAgent: req.get('user-agent') || ''
        });

        res.cookie(cookieName(tenant.slug), token, cookieOptions());

        const response = {
            success: true,
            tenantSlug: tenant.slug,
            adminAccessKey: user.rol !== 'super_admin' ? tenant.adminAccessKey : undefined,
            user: {
                nombre: user.nombre,
                email: user.email,
                usuario: user.usuario,
                rol: user.rol,
                accountNumber: tenant.accountNumber,
                adminAccessKey: user.rol !== 'super_admin' ? tenant.adminAccessKey : undefined
            },
            adminAccessKey: user.rol !== 'super_admin' ? tenant.adminAccessKey : undefined
        };
        if (process.env.NODE_ENV !== 'production') {
            response.devSessionToken = token;
        }
        res.json(response);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos inválidos', detalles: err.issues });
        }
        console.error('Error en login global:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
    try {
        const identifier = normalizeIdentifier(req.body.identifier);
        const genericResponse = { success: true, mensaje: 'Si la cuenta existe, enviaremos instrucciones de recuperación.' };
        if (!identifier) return res.json(genericResponse);

        const user = await findUserByIdentifier(identifier);

        if (!user) return res.json(genericResponse);

        const tenant = await Tenant.findById(user.tenantId);
        if (!tenant || !tenant.activo || tenant.status === 'deleted') {
            return res.json(genericResponse);
        }

        req.tenantId = tenant._id;
        req.user = user;
        const { resetUrl, emailStatus } = await createPasswordResetForUser(req, user, tenant);
        await auditLog(req, 'password_reset_requested', { tenantId: tenant._id, userId: user._id });

        res.json({
            ...genericResponse,
            devResetUrl: emailStatus.dev && process.env.NODE_ENV !== 'production' ? resetUrl : undefined
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al solicitar recuperación' });
    }
});

async function completeRecoveryCode(req, res) {
    try {
        const identifier = normalizeIdentifier(req.body.identifier);
        const code = String(req.body.code || '').trim();
        const password = String(req.body.password || '');
        if (!identifier || !/^\d{6}$/.test(code) || password.length < 8) {
            return res.status(400).json({ error: 'Datos de recuperacion invalidos' });
        }

        const user = await findUserByIdentifier(identifier, {
            ...(req.tenantId ? { tenantId: req.tenantId } : {})
        });
        if (!user) {
            return res.status(400).json({ error: 'Codigo invalido o expirado' });
        }
        const tenant = req.tenant || await Tenant.findById(user.tenantId);
        if (!tenant || tenant.status === 'deleted') {
            return res.status(400).json({ error: 'Codigo invalido o expirado' });
        }

        req.tenantId = tenant._id;
        const recovery = await RecoveryCode.findOne({
            tenantId: tenant._id,
            userId: user._id,
            usedAt: null,
            expiresAt: { $gt: new Date() },
            attempts: { $lt: 3 }
        }).sort({ createdAt: -1 });

        if (!recovery || recovery.codeHash !== sha256(`${user._id}:${code}`)) {
            if (recovery) {
                recovery.attempts += 1;
                if (recovery.attempts >= 3) recovery.usedAt = new Date();
                await recovery.save();
            }
            await auditLog(req, 'recovery_code_failed', {
                tenantId: tenant._id,
                targetUserId: user._id,
                attempts: recovery?.attempts || 0
            });
            return res.status(400).json({ error: 'Codigo invalido o expirado' });
        }

        user.passwordHash = await bcrypt.hash(password, 12);
        user.mustChangePassword = false;
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        await user.save();
        recovery.usedAt = new Date();
        await recovery.save();
        await Session.deleteMany({ tenantId: tenant._id, userId: user._id });
        await auditLog(req, 'recovery_code_completed', {
            tenantId: tenant._id,
            targetUserId: user._id
        });
        res.json({ success: true, mensaje: 'Contrasena actualizada correctamente' });
    } catch (error) {
        console.error('Error usando codigo de recuperacion:', error);
        res.status(500).json({ error: 'Error al restablecer acceso' });
    }
}

app.post('/api/auth/recovery-code', recoveryCodeLimiter, completeRecoveryCode);
app.post('/api/:tenant/auth/recovery-code', tenantMiddleware, recoveryCodeLimiter, completeRecoveryCode);

app.post('/api/:tenant/auth/login', tenantMiddleware, authLimiter, async (req, res) => {
    try {
        const { identifier, password } = loginSchema.parse(req.body);
        const normalized = normalizeIdentifier(identifier);
        const user = await findUserByIdentifier(normalized, { tenantId: req.tenantId });

        const genericError = { error: 'Credenciales inv\u00e1lidas' };
        if (!user) {
            await auditLog(req, 'login_failed', { identifier: normalized });
            return res.status(401).json(genericError);
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
            await auditLog(req, 'login_blocked', { userId: user._id });
            return res.status(423).json({ error: 'Cuenta bloqueada temporalmente. Intenta m\u00e1s tarde.' });
        }

        const validPassword = await bcrypt.compare(password, user.passwordHash);
        if (!validPassword) {
            user.failedLoginAttempts += 1;
            if (user.failedLoginAttempts >= 5) {
                user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
            }
            await user.save();
            await auditLog(req, 'login_failed', { userId: user._id });
            return res.status(401).json(genericError);
        }

        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        user.ultimoLogin = new Date();
        await user.save();

        const token = crearTokenSeguro();
        await Session.create({
            tenantId: req.tenantId,
            userId: user._id,
            tokenHash: sha256(token),
            expiresAt: nuevaExpiracionSesion(),
            lastActivityAt: new Date(),
            ip: req.ip,
            userAgent: req.get('user-agent') || ''
        });

        res.cookie(cookieName(req.tenant.slug), token, cookieOptions());
        await auditLog(req, 'login_success', { userId: user._id });
        const response = {
            success: true,
            user: {
                nombre: user.nombre,
                email: user.email,
                usuario: user.usuario,
                rol: user.rol,
                accountNumber: req.tenant.accountNumber,
                mustChangePassword: user.mustChangePassword === true,
                adminAccessKey: user.rol === 'tenant_admin' ? req.tenant.adminAccessKey : undefined
            },
            mustChangePassword: user.mustChangePassword === true,
            adminAccessKey: user.rol === 'tenant_admin' ? req.tenant.adminAccessKey : undefined
        };
        if (process.env.NODE_ENV !== 'production') {
            response.devSessionToken = token;
        }
        res.json(response);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos inv\u00e1lidos' });
        }
        res.status(500).json({ error: 'Error en el proceso de autenticación' });
    }
});

app.get('/api/:tenant/auth/me', tenantMiddleware, requireAdminAuth, async (req, res) => {
    res.json({
        user: {
            nombre: req.user.nombre,
            email: req.user.email,
            usuario: req.user.usuario,
            rol: req.user.rol,
            accountNumber: req.tenant.accountNumber
        }
    });
});

app.post('/api/:tenant/auth/logout', tenantMiddleware, requireAdminAuth, async (req, res) => {
    await Session.deleteOne({ _id: req.session._id, tenantId: req.tenantId });
    res.clearCookie(cookieName(req.tenant.slug), clearCookieOptions());
    await auditLog(req, 'logout');
    res.json({ success: true });
});

// Force-change-password: called when mustChangePassword=true (post super-admin reset).
// Does NOT require the current password — the temporary password was already verified at login.
app.post('/api/:tenant/auth/force-change-password', tenantMiddleware, requireAdminAuth, authLimiter, async (req, res) => {
    try {
        if (!req.user.mustChangePassword) {
            return res.status(403).json({ error: 'No se requiere cambio de contraseña forzado para este usuario' });
        }
        const newPassword = String(req.body.newPassword || '');
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
        }
        req.user.passwordHash = await bcrypt.hash(newPassword, 12);
        req.user.mustChangePassword = false;
        await req.user.save();
        // Invalidate all other active sessions so only this one persists
        await Session.deleteMany({ tenantId: req.tenantId, userId: req.user._id, _id: { $ne: req.session._id } });
        await auditLog(req, 'force_password_changed', { userId: req.user._id });
        res.json({ success: true, message: 'Contraseña actualizada correctamente. Bienvenido.' });
    } catch (err) {
        console.error('Error in force-change-password:', err);
        res.status(500).json({ error: 'Error al cambiar contraseña' });
    }
});

app.put('/api/:tenant/auth/password', tenantMiddleware, requireAdminAuth, authLimiter, async (req, res) => {
    try {
        const currentPassword = String(req.body.currentPassword || '');
        const newPassword = String(req.body.newPassword || '');
        if (!currentPassword || newPassword.length < 8) {
            return res.status(400).json({ error: 'Contraseña actual requerida y nueva contraseña mínima de 8 caracteres' });
        }

        const validPassword = await bcrypt.compare(currentPassword, req.user.passwordHash);
        if (!validPassword) {
            await auditLog(req, 'password_change_failed', { userId: req.user._id });
            return res.status(401).json({ error: 'La contraseña actual no es correcta' });
        }

        req.user.passwordHash = await bcrypt.hash(newPassword, 12);
        await req.user.save();
        await Session.deleteMany({ tenantId: req.tenantId, userId: req.user._id, _id: { $ne: req.session._id } });
        await auditLog(req, 'password_changed', { userId: req.user._id });

        res.json({ success: true, mensaje: 'Contraseña actualizada correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al cambiar contraseña' });
    }
});

app.post('/api/:tenant/auth/forgot-password', tenantMiddleware, authLimiter, async (req, res) => {
    try {
        const identifier = normalizeIdentifier(req.body.identifier);
        const genericResponse = { success: true, mensaje: 'Si la cuenta existe, enviaremos instrucciones de recuperación.' };
        if (!identifier) return res.json(genericResponse);

        const user = await findUserByIdentifier(identifier, { tenantId: req.tenantId });

        if (!user) {
            await auditLog(req, 'password_reset_requested_unknown', { identifier });
            return res.json(genericResponse);
        }

        const { resetUrl, emailStatus } = await createPasswordResetForUser(req, user, req.tenant);
        await auditLog(req, 'password_reset_requested', { userId: user._id });

        res.json({
            ...genericResponse,
            devResetUrl: emailStatus.dev && process.env.NODE_ENV !== 'production' ? resetUrl : undefined
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al solicitar recuperación' });
    }
});

app.post('/api/:tenant/auth/reset-password', tenantMiddleware, authLimiter, async (req, res) => {
    try {
        const token = String(req.body.token || '');
        const password = String(req.body.password || '');
        if (!token || password.length < 8) {
            await auditLog(req, 'password_reset_failed', { reason: 'invalid_payload' });
            return res.status(400).json({ error: 'Token inválido o contraseña muy corta' });
        }

        const reset = await PasswordResetToken.findOne({
            tenantId: req.tenantId,
            tokenHash: sha256(token),
            usedAt: { $exists: false },
            expiresAt: { $gt: new Date() }
        });

        if (!reset) {
            await auditLog(req, 'password_reset_failed', { reason: 'invalid_expired_or_used_token' });
            return res.status(400).json({ error: 'El enlace no es válido o expiró' });
        }

        const user = await User.findOne({ _id: reset.userId, tenantId: req.tenantId, activo: true });
        if (!user) {
            await auditLog(req, 'password_reset_failed', { reason: 'user_not_found' });
            return res.status(400).json({ error: 'El enlace no es válido o expiró' });
        }

        user.passwordHash = await bcrypt.hash(password, 12);
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        await user.save();

        reset.usedAt = new Date();
        await reset.save();
        await Session.deleteMany({ tenantId: req.tenantId, userId: user._id });
        await auditLog(req, 'password_reset_completed', { userId: user._id });

        res.json({ success: true, mensaje: 'Contraseña actualizada correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al restablecer contraseña' });
    }
});

app.get('/api/:tenant/categories', tenantMiddleware, async (req, res) => {
    try {
        const lista = await Category.find({ tenantId: req.tenantId }).sort('orden');
        res.json(lista);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener categorías' });
    }
});

app.get('/api/:tenant/admin/categories', tenantMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const lista = await Category.find({ tenantId: req.tenantId }).sort('orden');
        res.json(lista);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener categorías' });
    }
});

app.post('/api/:tenant/admin/categories', tenantMiddleware, requireAdminAuth, requireTenantOperational, async (req, res) => {
    try {
        const categoria = await Category.create({
            tenantId: req.tenantId,
            nombre: req.body.nombre,
            orden: parseInt(req.body.orden) || 999
        });
        res.status(201).json(categoria);
    } catch (err) {
        res.status(500).json({ error: 'Error al crear categoría' });
    }
});

app.put('/api/:tenant/admin/categories/:id', tenantMiddleware, requireAdminAuth, requireTenantOperational, async (req, res) => {
    try {
        const categoria = await Category.findOneAndUpdate(
            { _id: req.params.id, tenantId: req.tenantId },
            { nombre: req.body.nombre, orden: parseInt(req.body.orden) || 999 },
            { new: true }
        );
        if (!categoria) {
            return res.status(404).json({ error: 'Categoria no encontrada' });
        }
        res.json(categoria);
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar categoría' });
    }
});

app.delete('/api/:tenant/admin/categories/:id', tenantMiddleware, requireAdminAuth, requireTenantOperational, async (req, res) => {
    try {
        const productosEnCategoria = await Producto.countDocuments({ tenantId: req.tenantId, categoriaId: req.params.id });
        if (productosEnCategoria > 0) {
            return res.status(409).json({ error: 'No se puede eliminar una categoría con productos' });
        }
        const categoria = await Category.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
        if (!categoria) {
            return res.status(404).json({ error: 'Categoria no encontrada' });
        }
        res.json({ mensaje: 'Categoría eliminada exitosamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar categoria' });
    }
});

app.get('/api/:tenant/products', tenantMiddleware, requireTenantOperational, async (req, res) => {
    try {
        const lista = await Producto.find({ tenantId: req.tenantId, activo: true })
            .populate('categoriaId')
            .sort('ordenVisualizacion');
        res.json(lista.map(producto => productoResponse(producto, producto.categoriaId)));
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener productos activos' });
    }
});

app.get('/api/:tenant/admin/products', tenantMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const lista = await Producto.find({ tenantId: req.tenantId })
            .populate('categoriaId')
            .sort('ordenVisualizacion');
        res.json(lista.map(producto => productoResponse(producto, producto.categoriaId)));
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener todos los productos' });
    }
});

const productSchema = z.object({
    nombre: z.string().min(1).max(100),
    precio: z.string().or(z.number()).transform(val => parseFloat(val)),
    unidad: z.string().min(1).max(30),
    unidadMedida: z.string().max(30).optional(),
    categoriaId: z.string().optional(),
    categoria: z.string().optional(),
    orden: z.string().or(z.number()).transform(val => parseInt(val)).optional(),
    ordenVisualizacion: z.string().or(z.number()).transform(val => parseInt(val)).optional(),
    activo: z.string().or(z.boolean()).transform(val => val === 'true' || val === true).optional()
}).refine(data => data.categoriaId || data.categoria, {
    message: "Debe proporcionar una categoria"
});

app.post('/api/:tenant/admin/products', tenantMiddleware, requireAdminAuth, requireTenantOperational, upload.single('foto'), async (req, res) => {
    try {
        const data = productSchema.parse(req.body);
        
        if (req.tenant.planId) {
            const plan = await Plan.findById(req.tenant.planId);
            if (plan) {
                const count = await Producto.countDocuments({ tenantId: req.tenantId });
                if (count >= plan.productLimit) {
                    return res.status(403).json({ error: `Límite de productos alcanzado para tu plan (${plan.productLimit}).` });
                }
            }
        }

        const categoria = await buscarCategoriaTenant(req.tenantId, data.categoriaId || data.categoria);
        if (!categoria) {
            return res.status(400).json({ error: 'Categoria no encontrada o inválida' });
        }

        const imagenGuardada = await guardarImagenProducto(req.file, req.tenant.slug);
        const rutaImagen = imagenGuardada.url;

        const nuevoProducto = new Producto({
            tenantId: req.tenantId,
            categoriaId: categoria._id,
            categoria: categoria.nombre,
            nombre: data.nombre,
            precio: data.precio,
            unidad: data.unidad,
            unidadMedida: data.unidadMedida || data.unidad,
            imagen: rutaImagen,
            imagenUrl: rutaImagen,
            cloudinaryPublicId: imagenGuardada.publicId,
            orden: data.orden || 999,
            ordenVisualizacion: data.ordenVisualizacion || data.orden || 999,
            activo: data.activo !== undefined ? data.activo : true
        });

        await nuevoProducto.save();
        res.status(201).json({ mensaje: 'Producto creado exitosamente', producto: productoResponse(nuevoProducto, categoria) });
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ error: 'Datos de producto invalidos', detalles: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

app.put('/api/:tenant/admin/products/:id', tenantMiddleware, requireAdminAuth, requireTenantOperational, upload.single('foto'), async (req, res) => {
    try {
        const productoExistente = await Producto.findOne({ _id: req.params.id, tenantId: req.tenantId });
        if (!productoExistente) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const categoria = await buscarCategoriaTenant(req.tenantId, req.body.categoriaId || req.body.categoria || productoExistente.categoriaId);
        let rutaImagen = productoExistente.imagenUrl || productoExistente.imagen;

        if (req.file) {
            await eliminarImagen(rutaImagen, productoExistente.cloudinaryPublicId);
            const imagenGuardada = await guardarImagenProducto(req.file, req.tenant.slug);
            rutaImagen = imagenGuardada.url;
            productoExistente.cloudinaryPublicId = imagenGuardada.publicId;
        }

        if (categoria) {
            productoExistente.categoriaId = categoria._id;
            productoExistente.categoria = categoria.nombre;
        }
        productoExistente.nombre = req.body.nombre || productoExistente.nombre;
        productoExistente.precio = req.body.precio !== undefined ? parseFloat(req.body.precio) : productoExistente.precio;
        productoExistente.unidad = req.body.unidad || productoExistente.unidad;
        productoExistente.unidadMedida = req.body.unidadMedida || req.body.unidad || productoExistente.unidadMedida;
        productoExistente.imagen = rutaImagen;
        productoExistente.imagenUrl = rutaImagen;
        productoExistente.orden = req.body.orden !== undefined ? parseInt(req.body.orden) : productoExistente.orden;
        productoExistente.ordenVisualizacion = req.body.ordenVisualizacion !== undefined
            ? parseInt(req.body.ordenVisualizacion)
            : (req.body.orden !== undefined ? parseInt(req.body.orden) : productoExistente.ordenVisualizacion);

        if (req.body.activo !== undefined) {
            productoExistente.activo = req.body.activo === 'true' || req.body.activo === true;
        }

        await productoExistente.save();
        res.json({ mensaje: 'Producto actualizado exitosamente', producto: productoResponse(productoExistente, categoria) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

app.delete('/api/:tenant/admin/products/:id', tenantMiddleware, requireAdminAuth, requireTenantOperational, async (req, res) => {
    try {
        const producto = await Producto.findOne({ _id: req.params.id, tenantId: req.tenantId });
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        await eliminarImagen(producto.imagenUrl || producto.imagen, producto.cloudinaryPublicId);
        await Producto.deleteOne({ _id: req.params.id, tenantId: req.tenantId });
        res.json({ mensaje: 'Producto eliminado exitosamente' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

app.patch('/api/:tenant/admin/products/:id/toggle', tenantMiddleware, requireAdminAuth, requireTenantOperational, async (req, res) => {
    try {
        const producto = await Producto.findOne({ _id: req.params.id, tenantId: req.tenantId });
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        if (req.body && req.body.activo !== undefined) {
            producto.activo = req.body.activo === true || req.body.activo === 'true';
        } else {
            producto.activo = !producto.activo;
        }
        await producto.save();
        res.json({
            mensaje: `Producto ${producto.activo ? 'activado' : 'desactivado'} correctamente`,
            id: String(producto._id),
            activo: producto.activo
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al cambiar estado del producto' });
    }
});

const orderRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Demasiados pedidos desde esta IP, por favor intenta más tarde.' }
});

const pedidoSchema = z.object({
    cliente: z.object({
        nombre: z.string().min(1).max(100),
        telefono: z.string().min(1).max(20),
        direccion: z.string().trim().max(250).optional(),
        comentario: z.string().trim().max(500).optional()
    }),
    productos: z.array(z.object({
        productId: z.string().optional(),
        nombre: z.string(),
        cantidad: z.number().min(0.01),
        unidad: z.string(),
        precio: z.number().optional()
    })).min(1),
    total: z.number(),
    channel: z.enum(['cart', 'whatsapp']).optional(),
    pdfUrl: z.string().optional()
});

app.post('/api/:tenant/orders', tenantMiddleware, requireTenantOperational, orderRateLimit, async (req, res) => {
    try {
        const data = pedidoSchema.parse(req.body);
        const settings = await settingsTenant(req.tenant);
        const channel = data.channel || 'cart';
        if (channel === 'cart' && settings.orderCartEnabled === false) {
            return res.status(400).json({ error: 'La opcion de carrito esta desactivada para este catalogo' });
        }
        if (channel === 'whatsapp' && settings.orderWhatsappEnabled === false) {
            return res.status(400).json({ error: 'La opcion de WhatsApp esta desactivada para este catalogo' });
        }
        if ((settings.addressRequirement || 'optional') === 'required' && !data.cliente.direccion?.trim()) {
            return res.status(400).json({ error: 'La direccion es obligatoria para este catalogo' });
        }
        if ((settings.commentRequirement || 'optional') === 'required' && !data.cliente.comentario?.trim()) {
            return res.status(400).json({ error: 'El comentario es obligatorio para este catalogo' });
        }
        let totalCalculado = 0;
        const productosProcesados = [];

        for (const p of data.productos) {
            let precioReal = 0;
            if (p.productId && isValidUuid(p.productId)) {
                const dbProd = await Producto.findOne({ _id: p.productId, tenantId: req.tenantId });
                if (dbProd) {
                    precioReal = dbProd.precio;
                }
            }
            if (precioReal === 0) {
                precioReal = p.precio || 0;
            }
            totalCalculado += precioReal * p.cantidad;
            productosProcesados.push({
                nombre: p.nombre,
                precio: precioReal,
                cantidad: p.cantidad,
                unidad: p.unidad
            });
        }

        const nuevoPedido = new Pedido({
            tenantId: req.tenantId,
            cliente: {
                nombre: data.cliente.nombre,
                telefono: data.cliente.telefono,
                ...(data.cliente.direccion ? { direccion: data.cliente.direccion } : {}),
                ...(data.cliente.comentario ? { comentario: data.cliente.comentario } : {}),
                channel
            },
            telefono: data.cliente.telefono,
            productos: productosProcesados,
            total: totalCalculado,
            pdfUrl: data.pdfUrl || ''
        });
        await nuevoPedido.save();
        res.status(201).json({ success: true, mensaje: 'Pedido registrado exitosamente', pedido: nuevoPedido });
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos invalidos', detalles: err.issues });
        }
        console.error('Error al registrar pedido:', err);
        res.status(500).json({ error: 'Error al registrar el pedido en la base de datos' });
    }
});

app.get('/api/:tenant/admin/orders', tenantMiddleware, requireAdminAuth, async (req, res) => {
    try {
        await limpiarPedidosExpirados(req.tenantId);
        const lista = await Pedido.find({ tenantId: req.tenantId }).sort({ fecha: -1 });
        res.json(lista);
    } catch (err) {
        console.error('Error al obtener pedidos:', err);
        res.status(500).json({ error: 'Error al obtener el historial de pedidos' });
    }
});

app.delete('/api/:tenant/admin/orders/:id', tenantMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const pedidoEliminado = await Pedido.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
        if (!pedidoEliminado) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }
        res.json({ success: true, mensaje: 'Pedido eliminado del historial con éxito' });
    } catch (err) {
        console.error('Error al eliminar pedido:', err);
        res.status(500).json({ error: 'Error al intentar eliminar el pedido del historial' });
    }
});

app.delete('/api/:tenant/admin/orders', tenantMiddleware, requireAdminAuth, async (req, res) => {
    try {
        await Pedido.deleteMany({ tenantId: req.tenantId });
        res.json({ success: true, mensaje: 'Historial de pedidos limpiado por completo' });
    } catch (err) {
        console.error('Error al limpiar historial de pedidos:', err);
        res.status(500).json({ error: 'Error al intentar vaciar el historial de pedidos' });
    }
});



// Ruta comodín para endpoints no encontrados
app.all('*', (req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada en la API' });
});

// Global Error Handler (BUG-028)
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err);
    if (err.name === 'ValidationError') {
        return res.status(400).json({ error: 'Error de validación', detalles: err.message });
    }
    if (err.name === 'CastError') {
        return res.status(400).json({ error: 'ID inválido o formato incorrecto' });
    }
    if (err.message && err.message.includes('Formato no soportado')) {
        return res.status(400).json({ error: err.message });
    }
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'JSON inválido' });
    }
    res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3005;

async function startServer() {
    try {
        console.log('Utilizando base de datos relacional PostgreSQL con Prisma');
        await inicializarBase();
        console.log('Inicializacion de base de datos PostgreSQL completada');
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Servidor de API corriendo en el puerto ${PORT}`);
        });
    } catch (error) {
        console.error('No se pudo iniciar el backend:', error);
        await prisma.$disconnect();
        process.exit(1);
    }
}

startServer();

