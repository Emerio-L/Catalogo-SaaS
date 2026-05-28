const Tenant = require('../models/Tenant');

async function tenantMiddleware(req, res, next) {
    try {
        const slug = (req.params.tenant || req.params.slug || '').toLowerCase().trim();
        if (!slug) {
            return res.status(400).json({ error: 'Tenant requerido' });
        }

        const tenant = await Tenant.findOne({ slug });
        if (!tenant) {
            return res.status(404).json({ error: 'Catalogo no encontrado' });
        }
        if (!tenant.activo) {
            return res.status(403).json({ error: 'Catalogo inactivo' });
        }

        req.tenant = tenant;
        req.tenantId = tenant._id;
        next();
    } catch (err) {
        next(err);
    }
}

module.exports = tenantMiddleware;
