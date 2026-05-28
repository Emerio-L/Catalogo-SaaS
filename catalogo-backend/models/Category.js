const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    nombre: { type: String, required: true, trim: true },
    orden: { type: Number, default: 999 }
});

CategorySchema.index({ tenantId: 1, nombre: 1 }, { unique: true });

module.exports = mongoose.models.Category || mongoose.model('Category', CategorySchema);
