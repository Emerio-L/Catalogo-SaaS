const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    paymentMonth: { type: String, required: true, trim: true },
    paymentMethod: { type: String, default: '', trim: true },
    receiptUrl: { type: String, default: '', trim: true },
    status: { type: String, enum: ['pendiente', 'aprobado', 'rechazado'], default: 'pendiente', index: true },
    paidAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, default: '', trim: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

PaymentSchema.pre('save', function setUpdatedAt(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);
