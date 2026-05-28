const mongoose = require('mongoose');

const PasswordResetTokenSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    usedAt: { type: Date },
    ip: { type: String, default: '' },
    creadoEn: { type: Date, default: Date.now }
});

module.exports = mongoose.models.PasswordResetToken || mongoose.model('PasswordResetToken', PasswordResetTokenSchema);
