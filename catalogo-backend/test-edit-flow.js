const { prisma } = require('./db');
const crypto = require('crypto');

function sha256(valor) {
    return crypto.createHash('sha256').update(valor).digest('hex');
}

async function run() {
    console.log('--- STARTING DIAGNOSTIC TEST ---');
    const tenant = await prisma.tenant.findFirst({
        where: { slug: 'tienda-test-multiple' }
    }) || await prisma.tenant.findFirst();

    if (!tenant) {
        console.error('No tenant found in the database');
        return;
    }
    console.log('Using Tenant:', tenant.slug);

    const user = await prisma.user.findFirst({
        where: { tenantId: tenant.id }
    });
    if (!user) {
        console.error('No user found for tenant');
        return;
    }

    // 1. Find or create a product with 3 images
    let product = await prisma.product.findFirst({
        where: { tenantId: tenant.id }
    });

    const dummyImgs = [
        { url: '/uploads/test1.png', publicId: 'pid1', orden: 1, principal: true },
        { url: '/uploads/test2.png', publicId: 'pid2', orden: 2, principal: false },
        { url: '/uploads/test3.png', publicId: 'pid3', orden: 3, principal: false }
    ];

    if (!product) {
        console.log('Creating a dummy product...');
        product = await prisma.product.create({
            data: {
                tenantId: tenant.id,
                nombre: 'Prod Test',
                precio: 10,
                unidad: 'unidad',
                categoria: 'Verduras',
                imagen: '/uploads/test1.png',
                imagenUrl: '/uploads/test1.png',
                cloudinaryPublicId: 'pid1',
                imagenes: JSON.stringify(dummyImgs),
                activo: true
            }
        });
    } else {
        console.log('Updating existing product with 3 dummy images...');
        product = await prisma.product.update({
            where: { id: product.id },
            data: {
                imagenes: JSON.stringify(dummyImgs),
                imagen: '/uploads/test1.png',
                imagenUrl: '/uploads/test1.png',
                cloudinaryPublicId: 'pid1'
            }
        });
    }

    console.log('Initial product images in DB:', product.imagenes);

    // 2. Create test session
    const rawToken = 'test-token-' + crypto.randomBytes(4).toString('hex');
    const tokenHash = sha256(rawToken);
    const session = await prisma.session.create({
        data: {
            tenantId: tenant.id,
            userId: user.id,
            tokenHash: tokenHash,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            lastActivityAt: new Date(),
            ip: '127.0.0.1',
            userAgent: 'test-diagnostic'
        }
    });

    // 3. Make PUT request simulating deleting the 2nd image (keeping 1st and 3rd)
    const newLayout = [
        { type: 'existing', url: 'http://localhost:3005/uploads/test1.png', publicId: 'pid1', orden: 1, principal: true },
        { type: 'existing', url: 'http://localhost:3005/uploads/test3.png', publicId: 'pid3', orden: 2, principal: false }
    ];

    console.log('Sending PUT request with layout:', JSON.stringify(newLayout));

    // Form data boundary
    const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
    const dataParts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="nombre"\r\n\r\n${product.nombre}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="precio"\r\n\r\n${product.precio}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="unidad"\r\n\r\n${product.unidad}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="galeriaLayout"\r\n\r\n${JSON.stringify(newLayout)}\r\n`,
        `--${boundary}--\r\n`
    ];

    const bodyBuffer = Buffer.concat(dataParts.map(p => Buffer.from(p)));

    const fetchResult = await fetch(`http://localhost:3005/api/${tenant.slug}/admin/products/${product.id}`, {
        method: 'PUT',
        headers: {
            'Authorization': 'Bearer ' + rawToken,
            'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: bodyBuffer
    });

    console.log('Response Status:', fetchResult.status);
    const responseJson = await fetchResult.json();
    console.log('Response Body:', JSON.stringify(responseJson));

    // 4. Check DB state
    const updatedProduct = await prisma.product.findUnique({
        where: { id: product.id }
    });
    console.log('Updated product images in DB:', updatedProduct.imagenes);

    // Clean up session
    await prisma.session.delete({ where: { id: session.id } });
    await prisma.$disconnect();
    console.log('--- DIAGNOSTIC TEST END ---');
}

run().catch(console.error);
