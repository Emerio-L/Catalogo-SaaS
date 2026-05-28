const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema({
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '' },
    tipoNegocio: { type: String, default: 'personalizado', trim: true },
    logo: { type: String, default: '' },
    colorPrimario: { type: String, default: '#10b981' },
    whatsapp: { type: String, required: true, trim: true },
    adminAccessKey: { type: String, required: true, unique: true, trim: true },
    activo: { type: Boolean, default: true },
    creadoEn: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Tenant || mongoose.model('Tenant', TenantSchema);
