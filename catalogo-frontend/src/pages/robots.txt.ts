import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ url }) => {
    const origin = url.origin;
    const body = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /super-admin',
        'Disallow: /forgot-password',
        'Disallow: /reset-password',
        'Disallow: /api/',
        'Disallow: /c/*/p/',
        'Disallow: /c/*/forgot-password',
        'Disallow: /c/*/reset-password',
        `Sitemap: ${origin}/sitemap.xml`
    ].join('\n');

    return new Response(body, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
};
