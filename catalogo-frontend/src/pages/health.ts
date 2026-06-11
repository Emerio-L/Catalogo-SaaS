import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
    return new Response(JSON.stringify({
        ok: true,
        service: 'catalogo-frontend'
    }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        }
    });
};
