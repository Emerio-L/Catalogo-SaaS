const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    tipo: { type: String, required: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    metadata: { type: Object, default: {} },
    fecha: { type: Date, default: Date.now }
});

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
