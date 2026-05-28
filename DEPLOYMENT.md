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

## Railway

Configura el servicio con:

- Root Directory: `catalogo-backend`
- Start Command: `npm start`
- Healthcheck Path: `/health`
- Environment Variables:
  - `NODE_ENV=production`
  - `MONGODB_URI=...`
  - `FRONTEND_URL=https://TU-FRONTEND.vercel.app`
  - `CLOUDINARY_CLOUD_NAME=...`
  - `CLOUDINARY_API_KEY=...`
  - `CLOUDINARY_API_SECRET=...`
  - `RESEND_API_KEY=...` opcional para recuperación por correo
  - `AUTH_EMAIL_FROM=...` opcional para recuperación por correo

`FRONTEND_URL` acepta varios dominios separados por coma si necesitas previews o dominio propio.
