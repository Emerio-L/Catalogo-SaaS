import type { APIRoute } from 'astro';

const REQUEST_HEADERS_TO_FORWARD = new Set([
    'accept',
    'accept-language',
    'authorization',
    'content-type',
    'cookie',
    'user-agent'
]);

const RESPONSE_HEADERS_TO_SKIP = new Set([
    'connection',
    'content-encoding',
    'content-length',
    'transfer-encoding'
]);

function getBackendUrl() {
    const backendUrl = import.meta.env.BACKEND_URL || import.meta.env.PUBLIC_BACKEND_URL;
    if (!backendUrl) {
        throw new Error('BACKEND_URL no esta configurado en el frontend.');
    }
    return String(backendUrl).replace(/\/$/, '');
}

function isAllowedOrigin(request: Request, url: URL) {
    const origin = request.headers.get('origin');
    if (!origin) return true;

    const configuredSiteUrl = import.meta.env.PUBLIC_SITE_URL || 'https://sedelynk.com';
    const allowedOrigins = new Set([
        new URL(configuredSiteUrl).origin,
        url.origin
    ]);
    if (import.meta.env.DEV) {
        allowedOrigins.add('http://localhost:4321');
        allowedOrigins.add('http://127.0.0.1:4321');
    }
    return allowedOrigins.has(origin);
}

export const ALL: APIRoute = async ({ clientAddress, params, request, url }) => {
    try {
        const method = request.method.toUpperCase();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !isAllowedOrigin(request, url)) {
            return new Response(JSON.stringify({ error: 'Origen no permitido' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const targetUrl = `${getBackendUrl()}/api/${params.path || ''}${url.search}`;
        const headers = new Headers();

        request.headers.forEach((value, key) => {
            if (REQUEST_HEADERS_TO_FORWARD.has(key.toLowerCase())) {
                headers.set(key, value);
            }
        });
        const forwardedFor = request.headers.get('x-forwarded-for') || clientAddress;
        if (forwardedFor) {
            headers.set('x-forwarded-for', forwardedFor);
        }
        headers.set('x-forwarded-host', url.host);
        headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

        const requestBody = method === 'GET' || method === 'HEAD' ? undefined : request.body;
        const response = await fetch(targetUrl, {
            method,
            headers,
            body: requestBody,
            duplex: requestBody ? 'half' : undefined,
            redirect: 'manual'
        } as RequestInit & { duplex?: 'half' });

        const responseHeaders = new Headers();
        response.headers.forEach((value, key) => {
            if (!RESPONSE_HEADERS_TO_SKIP.has(key.toLowerCase())) {
                responseHeaders.append(key, value);
            }
        });

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
        });
    } catch (error) {
        console.error('Error en el gateway de API:', error);
        return new Response(JSON.stringify({
            error: 'No se pudo conectar con el servicio.'
        }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
