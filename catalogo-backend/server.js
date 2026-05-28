const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { v2: cloudinary } = require('cloudinary');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const Tenant = require('./models/Tenant');
const Category = require('./models/Category');
const Producto = require('./models/Product');
const Settings = require('./models/Settings');
const Pedido = require('./models/Order');
const User = require('./models/User');
const Session = require('./models/Session');
const PasswordResetToken = require('./models/PasswordResetToken');
const AuditLog = require('./models/AuditLog');
const tenantMiddleware = require('./middleware/tenant.middleware');

const app = express();
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:4321')
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        const normalizedOrigin = origin.replace(/\/$/, '');
        if (allowedOrigins.includes(normalizedOrigin)) {
            return callback(null, true);
        }
        return callback(new Error('Origen no permitido por CORS'));
    },
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const cloudinaryEnabled = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);
const ADMIN_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
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

// Conexión a MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/catalogo_db';
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('Conectado a MongoDB');
        inicializarBase();
    })
    .catch(err => console.error('Error de conexión a MongoDB:', err));

// Configuración de almacenamiento en memoria para Multer
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // límite de 5MB
});

// Modelo de Configuración de Seguridad
const ConfiguracionSchema = new mongoose.Schema({
    clave: { type: String, default: 'admin_config', unique: true },
    password: { type: String, default: 'admin123' },
    recoveryPin: { type: String, default: '987654' },
    preguntaSeguridad: { type: String, default: '¿Cómo se llamaba tu primera mascota?' },
    respuestaSeguridad: { type: String, default: 'mascota123' },
    tema: { type: String, default: 'emerald' },
    telefonoWhatsApp: { type: String, default: '50235387468' }
});

const Configuracion = mongoose.models.Configuracion || mongoose.model('Configuracion', ConfiguracionSchema);

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        service: 'catalogo-backend',
        mongo: mongoose.connection.readyState,
        cloudinary: cloudinaryEnabled
    });
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

function cookieName(tenantSlug) {
    return `catalogo_session_${tenantSlug}`;
}

function nuevaExpiracionSesion() {
    return new Date(Date.now() + ADMIN_IDLE_TIMEOUT_MS);
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
            tenantId: req.tenantId,
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

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
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
    if (categoriaInput && mongoose.Types.ObjectId.isValid(categoriaInput)) {
        const categoriaPorId = await Category.findOne({ _id: categoriaInput, tenantId });
        if (categoriaPorId) return categoriaPorId;
    }

    const nombreNormalizado = normalizarCategoria(categoriaInput);
    const categorias = await Category.find({ tenantId }).sort('orden');
    return categorias.find(cat => normalizarCategoria(cat.nombre) === nombreNormalizado) || categorias[0] || null;
}

async function asegurarTenantDefault() {
    let tenant = await Tenant.findOne({ slug: 'default' });
    const config = await Configuracion.findOne({ clave: 'admin_config' });
    const whatsapp = config?.telefonoWhatsApp || '50235387468';
    const tema = config?.tema || 'emerald';

    if (!tenant) {
        tenant = await Tenant.create({
            slug: 'default',
            nombre: 'Catálogo de Productos',
            descripcion: 'Selecciona tus productos y confirma tu pedido.',
            whatsapp,
            adminAccessKey: crearAdminAccessKey(),
            activo: true
        });
    } else if (!tenant.adminAccessKey) {
        tenant.adminAccessKey = crearAdminAccessKey();
        await tenant.save();
    }

    await Settings.updateOne(
        { tenantId: tenant._id },
        {
            $setOnInsert: {
                tenantId: tenant._id,
                whatsapp,
                tema,
                logo: tenant.logo || '',
                logoShape: 'rectangle',
                colorPrimario: tenant.colorPrimario || '#10b981',
                mostrarBuscador: true,
                mostrarCategorias: true,
                mostrarDescripcion: true,
                vistaPredeterminada: 'grid',
                monedaVisible: 'GTQ'
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
        await User.create({
            tenantId: tenant._id,
            nombre: 'Administrador',
            email: 'admin@example.com',
            usuario: 'admin',
            passwordHash: await bcrypt.hash(config?.password || 'admin123', 12),
            rol: 'owner',
            activo: true
        });
        console.log('Usuario admin inicial creado: admin / contraseña de configuración anterior.');
    }
}

async function inicializarBase() {
    await inicializarConfiguracion();
    await asegurarTenantDefault();
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
            mostrarDescripcion: true,
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
// Inicializar configuración con valores por defecto si está vacía
async function inicializarConfiguracion() {
    try {
        const config = await Configuracion.findOne({ clave: 'admin_config' });
        if (!config) {
            const nuevaConfig = new Configuracion();
            await nuevaConfig.save();
            console.log('Configuración de seguridad inicializada con valores por defecto.');
        } else {
            // Asegurar que existan los campos de pregunta y respuesta en registros antiguos
            let modificado = false;
            if (!config.preguntaSeguridad) {
                config.preguntaSeguridad = '¿Cómo se llamaba tu primera mascota?';
                modificado = true;
            }
            if (!config.respuestaSeguridad) {
                config.respuestaSeguridad = 'mascota123';
                modificado = true;
            }
            if (!config.tema) {
                config.tema = 'emerald';
                modificado = true;
            }
            if (!config.telefonoWhatsApp) {
                config.telefonoWhatsApp = '50235387468';
                modificado = true;
            }
            if (modificado) {
                await config.save();
                console.log('Campos de configuración actualizados en base de datos.');
            }
        }
    } catch (err) {
        console.error('Error al inicializar la configuración de seguridad:', err);
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
    const rutaAbsoluta = path.join(__dirname, rutaImagen);
    fs.unlink(rutaAbsoluta, (err) => {
        if (err) console.error(`No se pudo eliminar la imagen antigua: ${rutaAbsoluta}`, err);
        else console.log(`Imagen antigua eliminada: ${rutaAbsoluta}`);
    });
}

/* ==========================================================================
   RUTAS DE LA API - SEGURIDAD Y CONFIGURACIÓN
   ========================================================================== */

app.post('/api/admin/auth', async (req, res) => {
    res.status(410).json({ error: 'Ruta descontinuada. Usa /api/:tenant/auth/login.' });
});

app.post('/api/admin/auth/recovery', async (req, res) => {
    res.status(410).json({ error: 'Ruta descontinuada. Usa la recuperación segura por tenant.' });
});

// Obtener la pregunta de seguridad para el cliente
app.get('/api/admin/auth/recovery-question', async (req, res) => {
    res.status(410).json({ error: 'Ruta descontinuada. Usa la recuperación segura por tenant.' });
});

app.post('/api/admin/auth/recovery-question', async (req, res) => {
    res.status(410).json({ error: 'Ruta descontinuada. Usa la recuperación segura por tenant.' });
});

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
            logoShape: settings.logoShape || 'rectangle'
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
        const { tema, telefonoWhatsApp, whatsapp, colorPrimario, logo, logoShape, nombreNegocio, descripcionNegocio } = req.body;
        const settings = await settingsTenant(req.tenant);
        if (tema) settings.tema = tema;
        if (telefonoWhatsApp || whatsapp) settings.whatsapp = telefonoWhatsApp || whatsapp;
        if (colorPrimario) settings.colorPrimario = colorPrimario;
        if (logo) settings.logo = logo;
        if (logoShape) settings.logoShape = logoShape;
        if (nombreNegocio) settings.nombreNegocio = nombreNegocio;
        if (descripcionNegocio !== undefined) settings.descripcionNegocio = descripcionNegocio;
        await settings.save();
        res.json({ success: true, mensaje: 'Ajustes actualizados correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar ajustes' });
    }
});

app.get('/api/:tenant/settings', tenantMiddleware, async (req, res) => {
    try {
        const settings = await settingsTenant(req.tenant);
        res.json({
            whatsapp: settings.whatsapp,
            telefonoWhatsApp: settings.whatsapp,
            colorPrimario: settings.colorPrimario,
            logo: settings.logo,
            logoShape: settings.logoShape || 'rectangle',
            tema: settings.tema,
            theme: normalizarThemeTenant(settings.theme),
            nombreNegocio: req.tenant.nombre,
            descripcionNegocio: req.tenant.descripcion || '',
            mostrarBuscador: settings.mostrarBuscador,
            mostrarCategorias: settings.mostrarCategorias,
            mostrarDescripcion: settings.mostrarDescripcion,
            vistaPredeterminada: settings.vistaPredeterminada,
            monedaVisible: settings.monedaVisible
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener la configuración pública' });
    }
});

app.get('/api/:tenant/admin/settings', tenantMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const settings = await settingsTenant(req.tenant);
        res.json({
            whatsapp: settings.whatsapp,
            telefonoWhatsApp: settings.whatsapp,
            colorPrimario: settings.colorPrimario,
            logo: settings.logo,
            logoShape: settings.logoShape || 'rectangle',
            tema: settings.tema,
            theme: normalizarThemeTenant(settings.theme),
            nombreNegocio: req.tenant.nombre,
            descripcionNegocio: req.tenant.descripcion || '',
            mostrarBuscador: settings.mostrarBuscador,
            mostrarCategorias: settings.mostrarCategorias,
            mostrarDescripcion: settings.mostrarDescripcion,
            vistaPredeterminada: settings.vistaPredeterminada,
            monedaVisible: settings.monedaVisible
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
            theme,
            nombreNegocio,
            descripcionNegocio,
            mostrarBuscador,
            mostrarCategorias,
            mostrarDescripcion,
            vistaPredeterminada,
            monedaVisible
        } = req.body;
        const themeNormalizado = theme !== undefined ? normalizarThemeTenant(theme) : undefined;

        await Settings.updateOne(
            { tenantId: req.tenantId },
            {
                $set: {
                    ...(tema ? { tema } : {}),
                    ...(telefonoWhatsApp || whatsapp ? { whatsapp: telefonoWhatsApp || whatsapp } : {}),
                    ...(colorPrimario ? { colorPrimario } : {}),
                    ...(logo !== undefined ? { logo } : {}),
                    ...(logoShape ? { logoShape } : {}),
                    ...(themeNormalizado ? { theme: themeNormalizado } : {}),
                    ...(mostrarBuscador !== undefined ? { mostrarBuscador: Boolean(mostrarBuscador) } : {}),
                    ...(mostrarCategorias !== undefined ? { mostrarCategorias: Boolean(mostrarCategorias) } : {}),
                    ...(mostrarDescripcion !== undefined ? { mostrarDescripcion: Boolean(mostrarDescripcion) } : {}),
                    ...(vistaPredeterminada ? { vistaPredeterminada } : {}),
                    ...(monedaVisible ? { monedaVisible } : {})
                },
                $setOnInsert: { tenantId: req.tenantId }
            },
            { upsert: true }
        );

        if (telefonoWhatsApp || whatsapp || colorPrimario || logo !== undefined) {
            if (telefonoWhatsApp || whatsapp) req.tenant.whatsapp = telefonoWhatsApp || whatsapp;
            if (colorPrimario) req.tenant.colorPrimario = colorPrimario;
            if (logo !== undefined) req.tenant.logo = logo;
        }
        if (nombreNegocio !== undefined) req.tenant.nombre = String(nombreNegocio).trim() || req.tenant.nombre;
        if (descripcionNegocio !== undefined) req.tenant.descripcion = String(descripcionNegocio).trim();
        await req.tenant.save();

        res.json({ success: true, mensaje: 'Ajustes del tenant actualizados correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar ajustes del tenant' });
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
    tipoNegocio: z.enum(['verduleria', 'abarrotes', 'electronica', 'personalizado']).default('personalizado')
});

app.post('/api/tenants/register', authLimiter, async (req, res) => {
    let tenantCreado = null;
    try {
        const data = registerTenantSchema.parse(req.body);
        const slug = normalizarSlug(data.slug || data.nombre);
        const usuario = data.usuario.toLowerCase().trim();
        const email = (data.email || `${usuario}@${slug}.local`).toLowerCase().trim();
        const whatsapp = data.whatsapp.replace(/\D/g, '');

        if (!slug || slug === 'admin' || slug === 'api') {
            return res.status(400).json({ error: 'Slug inválido para el negocio' });
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

        tenantCreado = await Tenant.create({
            slug,
            nombre: data.nombre,
            descripcion: '',
            tipoNegocio: data.tipoNegocio,
            whatsapp,
            colorPrimario: '#10b981',
            adminAccessKey: crearAdminAccessKey(),
            activo: true
        });

        await Settings.create({
            tenantId: tenantCreado._id,
            whatsapp,
            colorPrimario: tenantCreado.colorPrimario,
            logo: '',
            logoShape: 'rectangle',
            theme: DEFAULT_TENANT_THEME,
            tema: 'emerald',
            mostrarBuscador: true,
            mostrarCategorias: true,
            mostrarDescripcion: true,
            vistaPredeterminada: 'grid',
            monedaVisible: 'GTQ'
        });

        await User.create({
            tenantId: tenantCreado._id,
            nombre: 'Administrador',
            email,
            usuario,
            passwordHash: await bcrypt.hash(data.password, 12),
            rol: 'owner',
            activo: true
        });

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
            return res.status(400).json({ error: 'Datos inválidos para crear la cuenta' });
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

app.post('/api/:tenant/auth/login', tenantMiddleware, authLimiter, async (req, res) => {
    try {
        const { identifier, password } = loginSchema.parse(req.body);
        const normalized = identifier.toLowerCase();
        const user = await User.findOne({
            tenantId: req.tenantId,
            activo: true,
            $or: [{ email: normalized }, { usuario: normalized }]
        });

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
                rol: user.rol
            }
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
            rol: req.user.rol
        }
    });
});

app.post('/api/:tenant/auth/logout', tenantMiddleware, requireAdminAuth, async (req, res) => {
    await Session.deleteOne({ _id: req.session._id, tenantId: req.tenantId });
    res.clearCookie(cookieName(req.tenant.slug), clearCookieOptions());
    await auditLog(req, 'logout');
    res.json({ success: true });
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
        const identifier = String(req.body.identifier || '').toLowerCase().trim();
        const genericResponse = { success: true, mensaje: 'Si la cuenta existe, enviaremos instrucciones de recuperación.' };
        if (!identifier) return res.json(genericResponse);

        const user = await User.findOne({
            tenantId: req.tenantId,
            activo: true,
            $or: [{ email: identifier }, { usuario: identifier }]
        });

        if (!user) {
            await auditLog(req, 'password_reset_requested_unknown', { identifier });
            return res.json(genericResponse);
        }

        const token = crearTokenSeguro();
        await PasswordResetToken.create({
            tenantId: req.tenantId,
            userId: user._id,
            tokenHash: sha256(token),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            ip: req.ip
        });

        const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host').replace(':3005', ':4321')}`;
        const resetUrl = `${frontendUrl}/c/${req.tenant.slug}/reset-password?token=${token}`;
        const emailStatus = await enviarEmailRecuperacion({ to: user.email, resetUrl });
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
            return res.status(400).json({ error: 'Token inválido o contraseña muy corta' });
        }

        const reset = await PasswordResetToken.findOne({
            tenantId: req.tenantId,
            tokenHash: sha256(token),
            usedAt: { $exists: false },
            expiresAt: { $gt: new Date() }
        });

        if (!reset) {
            return res.status(400).json({ error: 'El enlace no es válido o expiró' });
        }

        const user = await User.findOne({ _id: reset.userId, tenantId: req.tenantId, activo: true });
        if (!user) {
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

app.post('/api/:tenant/admin/categories', tenantMiddleware, requireAdminAuth, async (req, res) => {
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

app.put('/api/:tenant/admin/categories/:id', tenantMiddleware, requireAdminAuth, async (req, res) => {
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

app.delete('/api/:tenant/admin/categories/:id', tenantMiddleware, requireAdminAuth, async (req, res) => {
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

app.get('/api/:tenant/products', tenantMiddleware, async (req, res) => {
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

app.post('/api/:tenant/admin/products', tenantMiddleware, requireAdminAuth, upload.single('foto'), async (req, res) => {
    try {
        const categoria = await buscarCategoriaTenant(req.tenantId, req.body.categoriaId || req.body.categoria);
        if (!categoria) {
            return res.status(400).json({ error: 'Categoria requerida' });
        }

        const imagenGuardada = await guardarImagenProducto(req.file, req.tenant.slug);
        const rutaImagen = imagenGuardada.url;

        const nuevoProducto = new Producto({
            tenantId: req.tenantId,
            categoriaId: categoria._id,
            categoria: categoria.nombre,
            nombre: req.body.nombre,
            precio: parseFloat(req.body.precio),
            unidad: req.body.unidad,
            unidadMedida: req.body.unidadMedida || req.body.unidad,
            imagen: rutaImagen,
            imagenUrl: rutaImagen,
            cloudinaryPublicId: imagenGuardada.publicId,
            orden: parseInt(req.body.orden) || 999,
            ordenVisualizacion: parseInt(req.body.ordenVisualizacion || req.body.orden) || 999,
            activo: req.body.activo === 'true' || req.body.activo === true
        });

        await nuevoProducto.save();
        res.status(201).json({ mensaje: 'Producto creado exitosamente', producto: productoResponse(nuevoProducto, categoria) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

app.put('/api/:tenant/admin/products/:id', tenantMiddleware, requireAdminAuth, upload.single('foto'), async (req, res) => {
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

app.delete('/api/:tenant/admin/products/:id', tenantMiddleware, requireAdminAuth, async (req, res) => {
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

app.patch('/api/:tenant/admin/products/:id/toggle', tenantMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const producto = await Producto.findOne({ _id: req.params.id, tenantId: req.tenantId });
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        producto.activo = !producto.activo;
        await producto.save();
        res.json({ mensaje: `Producto ${producto.activo ? 'activado' : 'desactivado'} correctamente`, activo: producto.activo });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al cambiar estado del producto' });
    }
});

app.post('/api/:tenant/orders', tenantMiddleware, async (req, res) => {
    try {
        const nuevoPedido = new Pedido({
            tenantId: req.tenantId,
            cliente: {
                nombre: req.body.cliente.nombre,
                telefono: req.body.cliente.telefono
            },
            telefono: req.body.cliente.telefono,
            productos: req.body.productos,
            total: parseFloat(req.body.total),
            pdfUrl: req.body.pdfUrl || ''
        });
        await nuevoPedido.save();
        res.status(201).json({ success: true, mensaje: 'Pedido registrado exitosamente', pedido: nuevoPedido });
    } catch (err) {
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

// 1. Obtener productos activos (Para el cliente final)
app.get('/api/productos', async (req, res) => {
    try {
        const tenant = await tenantDefault();
        const lista = await Producto.find({ tenantId: tenant._id, activo: true }).populate('categoriaId').sort('ordenVisualizacion');
        res.json(lista.map(producto => productoResponse(producto, producto.categoriaId)));
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener productos activos' });
    }
});

// 2. Obtener TODOS los productos (Para el panel de administración)
app.get('/api/admin/productos', tenantDefaultMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const tenant = await tenantDefault();
        const lista = await Producto.find({ tenantId: tenant._id }).populate('categoriaId').sort('ordenVisualizacion');
        res.json(lista.map(producto => productoResponse(producto, producto.categoriaId)));
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener todos los productos' });
    }
});

// 3. Crear Producto con conversión automática a .webp
app.post('/api/admin/productos', tenantDefaultMiddleware, requireAdminAuth, upload.single('foto'), async (req, res) => {
    try {
        const tenant = await tenantDefault();
        const categoria = await buscarCategoriaTenant(tenant._id, req.body.categoria);
        let rutaImagen = '/uploads/placeholder.webp';

        if (req.file) {
            const nombreArchivo = `prod-${Date.now()}.webp`;
            const rutaDestino = path.join(uploadsDir, nombreArchivo);

            // Conversión forzada a WEBP usando Sharp
            await sharp(req.file.buffer)
                .webp({ quality: 80 })
                .toFile(rutaDestino);

            rutaImagen = `/uploads/${nombreArchivo}`;
        }

        const nuevoProducto = new Producto({
            tenantId: tenant._id,
            categoriaId: categoria?._id,
            categoria: categoria?.nombre || req.body.categoria,
            nombre: req.body.nombre,
            precio: parseFloat(req.body.precio),
            unidad: req.body.unidad,
            unidadMedida: req.body.unidad,
            imagen: rutaImagen,
            imagenUrl: rutaImagen,
            orden: parseInt(req.body.orden) || 999,
            ordenVisualizacion: parseInt(req.body.orden) || 999,
            activo: req.body.activo === 'true' || req.body.activo === true
        });

        await nuevoProducto.save();
        res.status(201).json({ mensaje: 'Producto creado exitosamente', producto: productoResponse(nuevoProducto, categoria) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

// 4. Actualizar Producto con soporte para cambiar imagen y limpiar la anterior
app.put('/api/admin/productos/:id', tenantDefaultMiddleware, requireAdminAuth, upload.single('foto'), async (req, res) => {
    try {
        const { id } = req.params;
        const tenant = await tenantDefault();
        const productoExistente = await Producto.findOne({ _id: id, tenantId: tenant._id });
        if (!productoExistente) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        const categoria = await buscarCategoriaTenant(tenant._id, req.body.categoria || productoExistente.categoriaId);

        let rutaImagen = productoExistente.imagenUrl || productoExistente.imagen;

        if (req.file) {
            // Eliminar imagen anterior si no es el placeholder
            eliminarImagen(productoExistente.imagen);

            const nombreArchivo = `prod-${Date.now()}.webp`;
            const rutaDestino = path.join(uploadsDir, nombreArchivo);

            // Convertir nueva imagen
            await sharp(req.file.buffer)
                .webp({ quality: 80 })
                .toFile(rutaDestino);

            rutaImagen = `/uploads/${nombreArchivo}`;
        }

        if (categoria) {
            productoExistente.categoriaId = categoria._id;
            productoExistente.categoria = categoria.nombre;
        }
        productoExistente.nombre = req.body.nombre || productoExistente.nombre;
        productoExistente.precio = req.body.precio !== undefined ? parseFloat(req.body.precio) : productoExistente.precio;
        productoExistente.unidad = req.body.unidad || productoExistente.unidad;
        productoExistente.unidadMedida = req.body.unidad || productoExistente.unidadMedida;
        productoExistente.imagen = rutaImagen;
        productoExistente.imagenUrl = rutaImagen;
        productoExistente.orden = req.body.orden !== undefined ? parseInt(req.body.orden) : productoExistente.orden;
        productoExistente.ordenVisualizacion = req.body.orden !== undefined ? parseInt(req.body.orden) : productoExistente.ordenVisualizacion;
        
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

// 5. Eliminar Producto y su imagen física
app.delete('/api/admin/productos/:id', tenantDefaultMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const tenant = await tenantDefault();
        const producto = await Producto.findOne({ _id: id, tenantId: tenant._id });
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Eliminar la imagen del disco
        eliminarImagen(producto.imagenUrl || producto.imagen);

        await Producto.deleteOne({ _id: id, tenantId: tenant._id });
        res.json({ mensaje: 'Producto eliminado exitosamente' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

// 6. Toggle rápido de estado activo/inactivo
app.patch('/api/admin/productos/:id/toggle', tenantDefaultMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const tenant = await tenantDefault();
        const producto = await Producto.findOne({ _id: id, tenantId: tenant._id });
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        producto.activo = !producto.activo;
        await producto.save();
        res.json({ mensaje: `Producto ${producto.activo ? 'activado' : 'desactivado'} correctamente`, activo: producto.activo });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al cambiar estado del producto' });
    }
});

// Registrar un nuevo pedido en la base de datos
app.post('/api/pedidos', async (req, res) => {
    try {
        const tenant = await tenantDefault();
        const nuevoPedido = new Pedido({
            tenantId: tenant._id,
            cliente: {
                nombre: req.body.cliente.nombre,
                telefono: req.body.cliente.telefono
            },
            telefono: req.body.cliente.telefono,
            productos: req.body.productos,
            total: parseFloat(req.body.total),
            pdfUrl: req.body.pdfUrl || ''
        });
        await nuevoPedido.save();
        res.status(201).json({ success: true, mensaje: 'Pedido registrado exitosamente', pedido: nuevoPedido });
    } catch (err) {
        console.error('Error al registrar pedido:', err);
        res.status(500).json({ error: 'Error al registrar el pedido en la base de datos' });
    }
});

// Obtener todos los pedidos (para el historial de administración)
app.get('/api/admin/pedidos', tenantDefaultMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const tenant = await tenantDefault();
        await limpiarPedidosExpirados(tenant._id);
        const lista = await Pedido.find({ tenantId: tenant._id }).sort({ fecha: -1 });
        res.json(lista);
    } catch (err) {
        console.error('Error al obtener pedidos:', err);
        res.status(500).json({ error: 'Error al obtener el historial de pedidos' });
    }
});

// Eliminar un pedido individual del historial
app.delete('/api/admin/pedidos/:id', tenantDefaultMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const tenant = await tenantDefault();
        const pedidoEliminado = await Pedido.findOneAndDelete({ _id: id, tenantId: tenant._id });
        if (!pedidoEliminado) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }
        res.json({ success: true, mensaje: 'Pedido eliminado del historial con éxito' });
    } catch (err) {
        console.error('Error al eliminar pedido:', err);
        res.status(500).json({ error: 'Error al intentar eliminar el pedido del historial' });
    }
});

// Limpiar por completo el historial de pedidos
app.delete('/api/admin/pedidos', tenantDefaultMiddleware, requireAdminAuth, async (req, res) => {
    try {
        const tenant = await tenantDefault();
        await Pedido.deleteMany({ tenantId: tenant._id });
        res.json({ success: true, mensaje: 'Historial de pedidos limpiado por completo' });
    } catch (err) {
        console.error('Error al limpiar historial de pedidos:', err);
        res.status(500).json({ error: 'Error al intentar vaciar el historial de pedidos' });
    }
});

// Ruta comodín para endpoints no encontrados
app.get('*', (req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada en la API' });
});

// Escuchar puerto
const PORT = process.env.PORT || 3005;
app.listen(PORT, () => console.log(`Servidor de API corriendo en http://localhost:${PORT}`));

