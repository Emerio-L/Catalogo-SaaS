const { prisma } = require('./db');
const crypto = require('crypto');
const http = require('http');

function sha256(valor) {
    return crypto.createHash('sha256').update(valor).digest('hex');
}

async function run() {
    const rawToken = 'my-super-secret-test-token-' + crypto.randomBytes(4).toString('hex');
    const tokenHash = sha256(rawToken);

    // Get tenant and user
    const tenant = await prisma.tenant.findFirst({
        where: { slug: 'hna-gaby' }
    });
    if (!tenant) {
        console.error('Tenant hna-gaby not found in database');
        return;
    }
    const user = await prisma.user.findFirst({
        where: { tenantId: tenant.id }
    });
    if (!user) {
        console.error('User not found for tenant');
        return;
    }

    console.log('Creating test session in DB for tenant:', tenant.slug);
    const session = await prisma.session.create({
        data: {
            tenantId: tenant.id,
            userId: user.id,
            tokenHash: tokenHash,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
            lastActivityAt: new Date(),
            ip: '127.0.0.1',
            userAgent: 'test-client'
        }
    });

    console.log('Sending request to /api/hna-gaby/admin/orders...');
    const options = {
        hostname: 'localhost',
        port: 3005,
        path: '/api/hna-gaby/admin/orders',
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + rawToken
        }
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', async () => {
            console.log('Response Status:', res.statusCode);
            console.log('Response Headers:', res.headers);
            console.log('Response Body:', data);
            
            // Clean up session
            console.log('Cleaning up session...');
            await prisma.session.delete({ where: { id: session.id } });
            await prisma.$disconnect();
        });
    });

    req.on('error', (err) => {
        console.error('HTTP Request failed:', err);
    });

    req.end();
}

run();
