const mongoose = require('mongoose');

const SaasSettingsSchema = new mongoose.Schema({
    key: { type: String, default: 'global', unique: true },
    supportWhatsapp: { type: String, default: '', trim: true },
    supportMessage: { type: String, default: 'Hola, necesito ayuda con mi catalogo.', trim: true },
    emulatorUrl: { type: String, default: '', trim: true },
    emulatorEnabled: { type: Boolean, default: false },
    logoUrl: { type: String, default: '', trim: true },
    logoCloudinaryPublicId: { type: String, default: '', trim: true },
    updatedAt: { type: Date, default: Date.now }
});

SaasSettingsSchema.pre('save', function setUpdatedAt(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.models.SaasSettings || mongoose.model('SaasSettings', SaasSettingsSchema);
