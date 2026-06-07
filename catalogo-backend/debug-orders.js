const { Pedido } = require('./db-compat');
const { prisma } = require('./db');

async function run() {
    try {
        const tenants = await prisma.tenant.findMany();
        console.log('Found tenants:', tenants.map(t => ({ id: t.id, slug: t.slug })));

        for (const tenant of tenants) {
            console.log(`\n--- Testing tenant: ${tenant.slug} (${tenant.id}) ---`);
            try {
                console.log('Running limpiarPedidosExpirados...');
                const DIAS_RETENCION_RECIBOS = 90;
                const limitDate = new Date(Date.now() - DIAS_RETENCION_RECIBOS * 24 * 60 * 60 * 1000);
                
                const deleteResult = await Pedido.deleteMany({
                    tenantId: tenant.id,
                    fecha: { $lt: limitDate }
                });
                console.log('Delete result:', deleteResult);

                console.log('Running Pedido.find()...');
                const list = await Pedido.find({ tenantId: tenant.id }).sort({ fecha: -1 });
                console.log('List count:', list.length);
            } catch (innerErr) {
                console.error(`ERROR for tenant ${tenant.slug}:`, innerErr);
            }
        }
    } catch (err) {
        console.error('Outer error:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
