const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Servir la carpeta de imágenes públicamente
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Servir el frontend estático
app.use(express.static(path.join(__dirname, 'public')));

// Conexión a MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/catalogo_db';
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('Conectado a MongoDB');
        inicializarConfiguracion();
    })
    .catch(err => console.error('Error de conexión a MongoDB:', err));

// Configuración de almacenamiento en memoria para Multer
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // límite de 5MB
});

// Modelo de Producto
const ProductoSchema = new mongoose.Schema({
    categoria: { type: String, required: true },
    nombre: { type: String, required: true },
    precio: { type: Number, required: true },
    unidad: { type: String, required: true },
    imagen: { type: String, default: '/uploads/placeholder.webp' },
    activo: { type: Boolean, default: true },
    orden: { type: Number, default: 999 }
});

const Producto = mongoose.model('Producto', ProductoSchema);

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

const Configuracion = mongoose.model('Configuracion', ConfiguracionSchema);

// Modelo de Pedido
const PedidoSchema = new mongoose.Schema({
    cliente: {
        nombre: { type: String, required: true },
        telefono: { type: String, required: true }
    },
    productos: [{
        nombre: { type: String, required: true },
        precio: { type: Number, required: true },
        cantidad: { type: Number, required: true },
        unidad: { type: String, required: true }
    }],
    total: { type: Number, required: true },
    fecha: { type: Date, default: Date.now }
});

const Pedido = mongoose.model('Pedido', PedidoSchema);

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
function eliminarImagen(rutaImagen) {
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

// Autenticar administrador
app.post('/api/admin/auth', async (req, res) => {
    try {
        const { password } = req.body;
        const config = await Configuracion.findOne({ clave: 'admin_config' });
        
        if (config && config.password === password) {
            return res.json({ success: true, mensaje: 'Autenticación exitosa' });
        }
        res.status(401).json({ error: 'Contraseña incorrecta' });
    } catch (err) {
        res.status(500).json({ error: 'Error en el proceso de autenticación' });
    }
});

// Recuperar contraseña mediante PIN
app.post('/api/admin/auth/recovery', async (req, res) => {
    try {
        const { pin, newPassword } = req.body;
        const config = await Configuracion.findOne({ clave: 'admin_config' });

        if (config && config.recoveryPin === pin) {
            config.password = newPassword;
            await config.save();
            return res.json({ success: true, mensaje: 'Contraseña restablecida con éxito' });
        }
        res.status(401).json({ error: 'PIN de recuperación incorrecto' });
    } catch (err) {
        res.status(500).json({ error: 'Error al intentar restablecer contraseña' });
    }
});

// Obtener la pregunta de seguridad para el cliente
app.get('/api/admin/auth/recovery-question', async (req, res) => {
    try {
        const config = await Configuracion.findOne({ clave: 'admin_config' });
        if (!config) {
            return res.status(404).json({ error: 'Configuración no encontrada' });
        }
        res.json({ pregunta: config.preguntaSeguridad });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener la pregunta de seguridad' });
    }
});

// Recuperar contraseña mediante Pregunta de Seguridad
app.post('/api/admin/auth/recovery-question', async (req, res) => {
    try {
        const { answer, newPassword } = req.body;
        const config = await Configuracion.findOne({ clave: 'admin_config' });

        if (config && config.respuestaSeguridad && config.respuestaSeguridad.toLowerCase().trim() === answer.toLowerCase().trim()) {
            config.password = newPassword;
            await config.save();
            return res.json({ success: true, mensaje: 'Contraseña restablecida con éxito' });
        }
        res.status(401).json({ error: 'Respuesta de seguridad incorrecta' });
    } catch (err) {
        res.status(500).json({ error: 'Error al intentar restablecer contraseña por pregunta' });
    }
});

// Obtener configuración pública (tema visual y teléfono WhatsApp)
app.get('/api/config', async (req, res) => {
    try {
        const config = await Configuracion.findOne({ clave: 'admin_config' });
        res.json({ 
            tema: config ? config.tema : 'emerald',
            telefonoWhatsApp: config ? config.telefonoWhatsApp : '50235387468'
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener la configuración pública' });
    }
});

// Obtener configuración de seguridad (para rellenar en panel admin)
app.get('/api/admin/config', async (req, res) => {
    try {
        const config = await Configuracion.findOne({ clave: 'admin_config' });
        if (!config) {
            return res.status(404).json({ error: 'Configuración no encontrada' });
        }
        res.json({
            password: config.password,
            recoveryPin: config.recoveryPin,
            preguntaSeguridad: config.preguntaSeguridad,
            respuestaSeguridad: config.respuestaSeguridad,
            tema: config.tema || 'emerald',
            telefonoWhatsApp: config.telefonoWhatsApp || '50235387468'
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener la configuración de seguridad' });
    }
});

// Modificar configuración de seguridad y apariencia
app.put('/api/admin/config', async (req, res) => {
    try {
        const { password, recoveryPin, preguntaSeguridad, respuestaSeguridad, tema, telefonoWhatsApp } = req.body;
        const config = await Configuracion.findOne({ clave: 'admin_config' });
        
        if (!config) {
            return res.status(404).json({ error: 'Configuración no encontrada' });
        }

        if (password) config.password = password;
        if (recoveryPin) config.recoveryPin = recoveryPin;
        if (preguntaSeguridad) config.preguntaSeguridad = preguntaSeguridad;
        if (respuestaSeguridad) config.respuestaSeguridad = respuestaSeguridad;
        if (tema) config.tema = tema;
        if (telefonoWhatsApp) config.telefonoWhatsApp = telefonoWhatsApp;

        await config.save();
        res.json({ success: true, mensaje: 'Ajustes actualizados correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar ajustes' });
    }
});

/* ==========================================================================
   RUTAS DE LA API - PRODUCTOS
   ========================================================================== */

// 1. Obtener productos activos (Para el cliente final)
app.get('/api/productos', async (req, res) => {
    try {
        const lista = await Producto.find({ activo: true }).sort('orden');
        res.json(lista);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener productos activos' });
    }
});

// 2. Obtener TODOS los productos (Para el panel de administración)
app.get('/api/admin/productos', async (req, res) => {
    try {
        const lista = await Producto.find().sort('orden');
        res.json(lista);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener todos los productos' });
    }
});

// 3. Crear Producto con conversión automática a .webp
app.post('/api/admin/productos', upload.single('foto'), async (req, res) => {
    try {
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
            categoria: req.body.categoria,
            nombre: req.body.nombre,
            precio: parseFloat(req.body.precio),
            unidad: req.body.unidad,
            imagen: rutaImagen,
            orden: parseInt(req.body.orden) || 999,
            activo: req.body.activo === 'true' || req.body.activo === true
        });

        await nuevoProducto.save();
        res.status(201).json({ mensaje: 'Producto creado exitosamente', producto: nuevoProducto });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

// 4. Actualizar Producto con soporte para cambiar imagen y limpiar la anterior
app.put('/api/admin/productos/:id', upload.single('foto'), async (req, res) => {
    try {
        const { id } = req.params;
        const productoExistente = await Producto.findById(id);
        if (!productoExistente) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        let rutaImagen = productoExistente.imagen;

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

        productoExistente.categoria = req.body.categoria || productoExistente.categoria;
        productoExistente.nombre = req.body.nombre || productoExistente.nombre;
        productoExistente.precio = req.body.precio !== undefined ? parseFloat(req.body.precio) : productoExistente.precio;
        productoExistente.unidad = req.body.unidad || productoExistente.unidad;
        productoExistente.imagen = rutaImagen;
        productoExistente.orden = req.body.orden !== undefined ? parseInt(req.body.orden) : productoExistente.orden;
        
        if (req.body.activo !== undefined) {
            productoExistente.activo = req.body.activo === 'true' || req.body.activo === true;
        }

        await productoExistente.save();
        res.json({ mensaje: 'Producto actualizado exitosamente', producto: productoExistente });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// 5. Eliminar Producto y su imagen física
app.delete('/api/admin/productos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const producto = await Producto.findById(id);
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Eliminar la imagen del disco
        eliminarImagen(producto.imagen);

        await Producto.findByIdAndDelete(id);
        res.json({ mensaje: 'Producto eliminado exitosamente' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

// 6. Toggle rápido de estado activo/inactivo
app.patch('/api/admin/productos/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;
        const producto = await Producto.findById(id);
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
        const nuevoPedido = new Pedido({
            cliente: {
                nombre: req.body.cliente.nombre,
                telefono: req.body.cliente.telefono
            },
            productos: req.body.productos,
            total: parseFloat(req.body.total)
        });
        await nuevoPedido.save();
        res.status(201).json({ success: true, mensaje: 'Pedido registrado exitosamente', pedido: nuevoPedido });
    } catch (err) {
        console.error('Error al registrar pedido:', err);
        res.status(500).json({ error: 'Error al registrar el pedido en la base de datos' });
    }
});

// Obtener todos los pedidos (para el historial de administración)
app.get('/api/admin/pedidos', async (req, res) => {
    try {
        const lista = await Pedido.find().sort({ fecha: -1 });
        res.json(lista);
    } catch (err) {
        console.error('Error al obtener pedidos:', err);
        res.status(500).json({ error: 'Error al obtener el historial de pedidos' });
    }
});

// Eliminar un pedido individual del historial
app.delete('/api/admin/pedidos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pedidoEliminado = await Pedido.findByIdAndDelete(id);
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
app.delete('/api/admin/pedidos', async (req, res) => {
    try {
        await Pedido.deleteMany({});
        res.json({ success: true, mensaje: 'Historial de pedidos limpiado por completo' });
    } catch (err) {
        console.error('Error al limpiar historial de pedidos:', err);
        res.status(500).json({ error: 'Error al intentar vaciar el historial de pedidos' });
    }
});

// Ruta comodín para redirigir al index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Escuchar puerto
const PORT = process.env.PORT || 3005;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
