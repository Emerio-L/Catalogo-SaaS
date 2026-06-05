const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    monthlyPrice: { type: Number, required: true, min: 0 },
    trialDays: { type: Number, default: 0, min: 0 },
    graceDays: { type: Number, default: 0, min: 0 },
    productLimit: { type: Number, default: null, min: 0 },
    features: [{ type: String, trim: true }],
    isActive: { type: Boolean, default: true, index: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

PlanSchema.pre('save', function setUpdatedAt(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.models.Plan || mongoose.model('Plan', PlanSchema);
