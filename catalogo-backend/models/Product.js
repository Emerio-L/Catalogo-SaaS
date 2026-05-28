const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    categoriaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true },
    categoria: { type: String, trim: true },
    nombre: { type: String, required: true },
    precio: { type: Number, required: true },
    unidad: { type: String },
    unidadMedida: { type: String },
    imagen: { type: String },
    imagenUrl: { type: String },
    cloudinaryPublicId: { type: String },
    activo: { type: Boolean, default: true },
    orden: { type: Number },
    ordenVisualizacion: { type: Number, default: 999 },
    creadoEn: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Producto || mongoose.model('Producto', ProductSchema);
