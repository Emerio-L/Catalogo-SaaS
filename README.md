# SEDELYNK

SaaS de catalogos digitales con pedidos, WhatsApp, administracion multi-tenant,
soporte, pagos y recuperacion de acceso.

## Componentes

- `catalogo-frontend`: Astro SSR y gateway `/api`.
- `catalogo-backend`: Express, Prisma y PostgreSQL.
- `catalogo-backend/prisma/migrations`: historial versionado del esquema.

## Desarrollo local

Backend:

```bash
cd catalogo-backend
npm install
npx prisma migrate deploy
npm run ensure:superadmin
npm run dev
```

Frontend:

```bash
cd catalogo-frontend
npm install
npm run dev
```

Usa los archivos `.env.example` como referencia. Los `.env` reales no se
versionan.

## Produccion

La guia completa para Railway y PostgreSQL esta en
[DEPLOYMENT.md](./DEPLOYMENT.md).
