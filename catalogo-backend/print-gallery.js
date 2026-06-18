const { prisma } = require('./db');

async function run() {
    try {
        const prod = await prisma.product.findUnique({
            where: { id: '4348b210-697b-43ca-ab90-c15afb56fa8d' }
        });
        console.log('Product Name:', prod.nombre);
        console.log('Product Main Image:', prod.imagen);
        console.log('Product Gallery JSON:', prod.imagenes);
    } catch (err) {
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
