# SEDELYNK Frontend

Frontend Astro SSR para la landing, catalogos tenant, paneles administrativos y
gateway same-origin `/api`.

## Desarrollo

```bash
npm install
npm run dev
```

Variables:

```env
BACKEND_URL=http://localhost:3005
PUBLIC_BACKEND_URL=http://localhost:3005
```

- `BACKEND_URL`: destino server-side del gateway `/api`.
- `PUBLIC_BACKEND_URL`: origen publico para imagenes y archivos.

## Produccion

```bash
npm run build
npm start
```

El adaptador `@astrojs/node` se ejecuta en modo standalone. En Railway define
`HOST=0.0.0.0`; Railway inyecta `PORT`.

Consulta [DEPLOYMENT.md](../DEPLOYMENT.md) para el despliegue completo.
