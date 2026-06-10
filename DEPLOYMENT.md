# Despliegue

Este proyecto está preparado como monorepo privado:

- `catalogo-frontend`: Astro para Vercel.
- `catalogo-backend`: Express para Railway.

## Vercel

Configura el proyecto con:

- Root Directory: `catalogo-frontend`
- Build Command: `npm run build`
- Environment Variable:
  - `PUBLIC_BACKEND_URL=https://TU-BACKEND.railway.app`

## Railway (Backend)

Configura el servicio con:

- Root Directory: `catalogo-backend`
- Start Command: `npm start`
- Healthcheck Path: `/health`
- Environment Variables Obligatorias:
  - `NODE_ENV=production`
  - `MONGODB_URI=mongodb+srv://...`
  - `FRONTEND_URL=https://TU-FRONTEND.vercel.app` (acepta varios separados por coma)
  - `SUPER_ADMIN_USER=tu-usuario-superadmin`
  - `SUPER_ADMIN_PASSWORD=tu-password-seguro`
  
- Environment Variables Opcionales:
  - `SUPER_ADMIN_EMAIL=correo@ejemplo.com`
  - `SUPER_ADMIN_NAME=Super Admin`
  - `CLOUDINARY_CLOUD_NAME=...` (para subida de imágenes)
  - `CLOUDINARY_API_KEY=...`
  - `CLOUDINARY_API_SECRET=...`

**Nota de Seguridad:** Asegúrate de configurar `SUPER_ADMIN_USER` y `SUPER_ADMIN_PASSWORD` en tu entorno de producción de Railway para proteger el panel principal del SaaS.
# Actualizacion SaaS: cuentas, soporte y recuperacion

Antes de iniciar una version que incluya esta actualizacion:

```bash
cd catalogo-backend
npm install
npx prisma generate
npx prisma migrate deploy
```

La migracion asigna automaticamente `accountNumber` a cuentas existentes y crea
las tablas `SupportTicket` y `RecoveryCode`. El proceso es aditivo y no elimina
tenants, productos, pedidos, pagos, sesiones ni archivos de Cloudinary.

El backfill tambien puede verificarse de forma idempotente:

```bash
npm run accounts:backfill
```

Para correos de bienvenida y recuperacion configura:

```env
RESEND_API_KEY=
AUTH_EMAIL_FROM=
FRONTEND_URL=https://tu-dominio.com
```

Prueba integral local:

```bash
npm run test:saas-upgrade
```
