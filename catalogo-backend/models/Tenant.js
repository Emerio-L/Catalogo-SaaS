const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema({
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '' },
    ownerName: { type: String, default: '', trim: true },
    email: { type: String, default: '', lowercase: true, trim: true },
    tipoNegocio: { type: String, default: 'personalizado', trim: true },
    logo: { type: String, default: '' },
    colorPrimario: { type: String, default: '#10b981' },
    whatsapp: { type: String, required: true, trim: true },
    adminAccessKey: { type: String, required: true, unique: true, trim: true },
    activo: { type: Boolean, default: true },
    status: {
        type: String,
        enum: ['trial', 'active', 'pending_payment', 'suspended', 'deleted'],
        default: 'trial',
        index: true
    },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null, index: true },
    monthlyPrice: { type: Number, default: 0, min: 0 },
    trialStartDate: { type: Date, default: null },
    trialEndDate: { type: Date, default: null },
    billingDay: { type: Number, default: null, min: 1, max: 31 },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    paymentDueDate: { type: Date, default: null },
    lastPaymentAt: { type: Date, default: null },
    suspendedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedReason: { type: String, default: '', trim: true },
    creadoEn: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

TenantSchema.pre('save', function setUpdatedAt(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.models.Tenant || mongoose.model('Tenant', TenantSchema);
