const mongoose = require('mongoose');

const RECIBO_RETENTION_SECONDS = 60 * 60 * 24 * 90;

const OrderSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    cliente: {
        nombre: { type: String, required: true },
        telefono: { type: String, required: true }
    },
    telefono: { type: String },
    productos: [{
        nombre: { type: String, required: true },
        precio: { type: Number, required: true },
        cantidad: { type: Number, required: true },
        unidad: { type: String, required: true }
    }],
    total: { type: Number, required: true },
    pdfUrl: { type: String, default: '' },
    fecha: { type: Date, default: Date.now }
});

OrderSchema.index({ fecha: 1 }, { expireAfterSeconds: RECIBO_RETENTION_SECONDS });

module.exports = mongoose.models.Pedido || mongoose.model('Pedido', OrderSchema);
