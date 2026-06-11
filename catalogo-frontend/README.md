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
HOST=0.0.0.0
PORT=4321
```

- `BACKEND_URL`: destino server-side del gateway `/api`. En Railway usa la red
  privada y el puerto interno del backend.
- `PUBLIC_BACKEND_URL`: origen publico para imagenes y archivos.
- `HOST`: permite aceptar conexiones externas dentro del contenedor.
- `PORT`: puerto de escucha; Railway puede usar `8080`.

## Produccion

```bash
npm run build
npm start
```

El adaptador `@astrojs/node` se ejecuta en modo standalone. En Railway define
`HOST=0.0.0.0`; Railway inyecta `PORT`. El healthcheck es `/health`.

Consulta [DEPLOYMENT.md](../DEPLOYMENT.md) para el despliegue completo.
