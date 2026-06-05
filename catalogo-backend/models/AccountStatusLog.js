const mongoose = require('mongoose');

const AccountStatusLogSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    previousStatus: { type: String, default: '', trim: true },
    newStatus: { type: String, required: true, trim: true },
    reason: { type: String, default: '', trim: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.AccountStatusLog || mongoose.model('AccountStatusLog', AccountStatusLogSchema);
