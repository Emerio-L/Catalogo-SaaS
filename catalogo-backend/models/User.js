const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    nombre: { type: String, default: 'Administrador', trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    usuario: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    rol: { type: String, enum: ['super_admin', 'owner', 'admin', 'tenant_admin'], default: 'owner' },
    activo: { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    ultimoLogin: { type: Date },
    creadoEn: { type: Date, default: Date.now }
});

UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, usuario: 1 }, { unique: true });

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
