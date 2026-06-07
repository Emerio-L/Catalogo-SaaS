const { Pedido } = require('./db-compat');
const { prisma } = require('./db');

async function run() {
    try {
        console.log('Testing deleteMany with tenantId = undefined...');
        const deleteResult = await Pedido.deleteMany({
            tenantId: undefined,
            fecha: { $lt: new Date() }
        });
        console.log('deleteMany result:', deleteResult);
    } catch (err) {
        console.error('deleteMany with undefined tenantId FAILED:', err);
    }

    try {
        console.log('Testing find with tenantId = undefined...');
        const findResult = await Pedido.find({ tenantId: undefined }).sort({ fecha: -1 });
        console.log('find result count:', findResult.length);
    } catch (err) {
        console.error('find with undefined tenantId FAILED:', err);
    }

    try {
        console.log('Testing deleteMany with tenantId = null...');
        const deleteResult = await Pedido.deleteMany({
            tenantId: null,
            fecha: { $lt: new Date() }
        });
        console.log('deleteMany result:', deleteResult);
    } catch (err) {
        console.error('deleteMany with null tenantId FAILED:', err);
    }

    try {
        console.log('Testing find with tenantId = null...');
        const findResult = await Pedido.find({ tenantId: null }).sort({ fecha: -1 });
        console.log('find result count:', findResult.length);
    } catch (err) {
        console.error('find with null tenantId FAILED:', err);
    }

    await prisma.$disconnect();
}

run();
