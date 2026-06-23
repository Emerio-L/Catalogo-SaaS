const { Tenant } = require('../data-access');
const { sharedCache } = require('../utils/cache');

async function tenantMiddleware(req, res, next) {
    try {
        const slug = (req.params.tenant || req.params.slug || '').toLowerCase().trim();
        if (!slug) {
            return res.status(400).json({ error: 'Tenant requerido' });
        }

        const cacheKey = `tenant:${slug}`;
        let tenant = sharedCache.get(cacheKey);

        if (!tenant) {
            tenant = await Tenant.findOne({ slug });
            if (tenant) {
                sharedCache.set(cacheKey, tenant, 120000); // 2 minutos de TTL
            }
        }

        if (!tenant) {
            return res.status(404).json({ error: 'Catalogo no encontrado' });
        }
        if (tenant.status === 'deleted') {
            return res.status(404).json({ error: 'Catalogo no encontrado', status: tenant.status });
        }

        req.tenant = tenant;
        req.tenantId = tenant.id;
        next();
    } catch (err) {
        next(err);
    }
}

module.exports = tenantMiddleware;


