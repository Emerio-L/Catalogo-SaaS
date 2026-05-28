const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true, index: true },
    whatsapp: { type: String, required: true, trim: true },
    colorPrimario: { type: String, default: '#10b981' },
    logo: { type: String, default: '' },
    logoCloudinaryPublicId: { type: String, default: '' },
    logoShape: { type: String, enum: ['rectangle', 'circle'], default: 'rectangle' },
    tema: { type: String, default: 'emerald' },
    theme: { type: mongoose.Schema.Types.Mixed, default: null },
    mostrarBuscador: { type: Boolean, default: true },
    mostrarCategorias: { type: Boolean, default: true },
    mostrarDescripcion: { type: Boolean, default: true },
    vistaPredeterminada: { type: String, default: 'grid' },
    monedaVisible: { type: String, default: 'GTQ' }
});

module.exports = mongoose.models.Settings || mongoose.model('Settings', SettingsSchema);
