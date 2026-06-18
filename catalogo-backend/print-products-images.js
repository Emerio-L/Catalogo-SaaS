const { prisma } = require('./db');

async function run() {
    try {
        const products = await prisma.product.findMany({
            select: {
                id: true,
                nombre: true,
                imagen: true,
                imagenUrl: true,
                tenant: {
                    select: {
                        slug: true
                    }
                }
            }
        });
        console.log('--- PRODUCTS IN DATABASE ---');
        console.dir(products, { depth: null });
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await prisma.$disconnect();
    }
}

run();
