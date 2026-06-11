# Despliegue completo en Railway

Arquitectura de produccion:

- `Postgres`: base de datos PostgreSQL administrada por Railway.
- `Catalogo-SaaS`: API Express + Prisma desde `catalogo-backend`.
- `frontend`: Astro SSR desde `catalogo-frontend`.
- Cloudinary: almacenamiento persistente de imagenes y archivos.

Los servicios `backend` y `frontend` incluyen `railway.json` con build, inicio,
healthcheck y migraciones. No se usa almacenamiento local para archivos en
produccion porque el filesystem de un despliegue no es persistente.

El frontend y el backend se despliegan como servicios separados dentro del
mismo proyecto Railway. Esta separacion conserva Astro SSR y el gateway
same-origin `/api`, permite desplegar cada servicio de forma independiente y
evita acoplar el ciclo de vida del frontend al backend estable.

## 1. Requisitos

- Repositorio actualizado en GitHub.
- Cuenta de Railway conectada a GitHub.
- Cuenta de Cloudinary.
- Node.js 22.12 o posterior para pruebas locales.
- Herramientas PostgreSQL (`pg_dump`, `pg_restore`, `psql`) solo si se migraran
  datos existentes.

## 2. Crear proyecto y PostgreSQL

1. En Railway selecciona `New Project`.
2. Agrega una base con `New` > `Database` > `PostgreSQL`.
3. Nombra el servicio `Postgres`.
4. Activa backups en el servicio PostgreSQL antes de poner la aplicacion en uso.

Railway expone `DATABASE_URL` en el servicio PostgreSQL. El backend debe
referenciar esa variable; no copies una clave estatica.

## 3. Elegir el tipo de base de datos

### Opcion A: base nueva

No ejecutes comandos manuales. Al desplegar el backend, su pre-deploy ejecuta:

```bash
npm run prisma:deploy
npm run accounts:backfill
npm run ensure:superadmin
```

Esto crea el esquema, completa numeros de cuenta y crea el superadministrador.

### Opcion B: subir la base local con todos los datos

Hazlo antes del primer despliegue del backend y sobre una base Railway vacia.
Obtiene la URL publica desde `Postgres` > `Connect`.

En PowerShell:

```powershell
$env:SOURCE_DATABASE_URL='postgresql://usuario:clave@localhost:5432/sedelynk_dev'
$env:TARGET_DATABASE_URL='postgresql://postgres:CLAVE@HOST_PROXY:PUERTO/railway'

pg_dump --format=custom --no-owner --no-privileges `
  --dbname=$env:SOURCE_DATABASE_URL `
  --file=sedelynk-production.dump

pg_restore --no-owner --no-privileges `
  --dbname=$env:TARGET_DATABASE_URL `
  sedelynk-production.dump

psql $env:TARGET_DATABASE_URL -c 'SELECT COUNT(*) FROM "Tenant";'
```

El archivo `.dump` contiene datos sensibles: no lo agregues a Git ni lo
compartas. Despues del restore, el pre-deploy de Prisma aplicara solamente las
migraciones que falten.

## 4. Crear el backend

1. Agrega un servicio desde este repositorio de GitHub.
2. Conserva el nombre actual `Catalogo-SaaS` o renombralo a `backend`.
3. En `Settings` configura:
   - Root Directory: `/catalogo-backend`
   - Config File Path: `/catalogo-backend/railway.json`
4. En `Variables` agrega:

```env
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}

SUPER_ADMIN_USER=elige-un-usuario
SUPER_ADMIN_PASSWORD=elige-una-clave-larga-y-unica
SUPER_ADMIN_EMAIL=tu-correo@dominio.com
SUPER_ADMIN_NAME=Super Administrador

DEFAULT_TENANT_ADMIN_USER=admin
DEFAULT_TENANT_ADMIN_PASSWORD=elige-otra-clave-larga-y-unica
DEFAULT_TENANT_ADMIN_EMAIL=admin@dominio.com
DEFAULT_TENANT_ADMIN_NAME=Administrador

CLOUDINARY_CLOUD_NAME=tu-cloud-name
CLOUDINARY_API_KEY=tu-api-key
CLOUDINARY_API_SECRET=tu-api-secret
```

Opcionales para recuperacion por correo:

```env
RESEND_API_KEY=
AUTH_EMAIL_FROM=soporte@tu-dominio.com
```

5. En `Networking`, genera un dominio publico.
6. El healthcheck configurado es `/health`.

Define explicitamente el puerto interno para que el frontend pueda
referenciarlo como variable de otro servicio:

```env
PORT=8080
```

## 5. Crear el frontend

1. Agrega un segundo servicio desde el mismo repositorio.
2. Nombra el servicio `frontend`.
3. En `Settings` configura:
   - Root Directory: `/catalogo-frontend`
   - Config File Path: `/catalogo-frontend/railway.json`
4. En `Variables` agrega:

```env
NODE_ENV=production
HOST=0.0.0.0
BACKEND_URL=http://${{Catalogo-SaaS.RAILWAY_PRIVATE_DOMAIN}}:${{Catalogo-SaaS.PORT}}
PUBLIC_BACKEND_URL=https://${{Catalogo-SaaS.RAILWAY_PUBLIC_DOMAIN}}
```

`BACKEND_URL` es server-side y usa la red privada de Railway. No debe llevar el
prefijo `PUBLIC_`. `PUBLIC_BACKEND_URL` se usa para imagenes o archivos que el
navegador carga directamente. Si renombraste el servicio a `backend`, cambia
`Catalogo-SaaS` por `backend` en ambas referencias.

5. En `Networking`, genera el dominio publico del frontend.
6. Regresa a las variables del backend y agrega:

```env
FRONTEND_URL=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}
```

7. Redeploya el backend para aplicar el origen y las URLs de recuperacion.

El navegador llama siempre a `/api` sobre el dominio del frontend. Astro
reenvia esas solicitudes al backend mediante `BACKEND_URL`, por lo que las
rutas de interfaz y las rutas API no entran en conflicto.

## 6. Dominio personalizado

Asigna el dominio principal al servicio `frontend`, por ejemplo
`app.tudominio.com`. Luego cambia en el backend:

```env
FRONTEND_URL=https://app.tudominio.com
```

No es necesario cambiar el codigo ni `BACKEND_URL`. El backend puede conservar
su dominio Railway para `/health` y recursos publicos. Si mas adelante asignas
`api.tudominio.com` al backend, actualiza `PUBLIC_BACKEND_URL` en el frontend y
vuelve a desplegarlo.

## 7. Verificacion

Comprueba:

```text
https://DOMINIO-BACKEND/health
https://DOMINIO-FRONTEND/health
https://DOMINIO-FRONTEND/
https://DOMINIO-FRONTEND/super-admin
```

El healthcheck debe responder con `ok: true` y `postgres: connected`.

Pruebas funcionales:

1. Iniciar sesion como superadministrador.
2. Crear o abrir una cuenta tenant.
3. Subir una imagen y confirmar que la URL sea de Cloudinary.
4. Enviar el formulario de soporte con y sin correo.
5. Crear un pedido y verificarlo en PostgreSQL.
6. Ejecutar un redeploy y confirmar que las imagenes sigan disponibles.

## 8. Alternativa descartada: frontend servido por Express

No se recomienda para esta version. El frontend usa Astro SSR y contiene un
gateway dinamico en `src/pages/api/[...path].ts`; no es solamente un directorio
de archivos estaticos. Servirlo desde Express requeriria convertirlo a salida
estatica o integrar dos servidores Node en un solo proceso, aumentando el
riesgo y haciendo que cualquier despliegue visual reinicie tambien la API.

Esta alternativa seria razonable solamente si el frontend se convierte en un
sitio completamente estatico sin rutas server-side.

## 9. Actualizaciones futuras

Cada push a `main` dispara los servicios conectados. El backend ejecuta
`prisma migrate deploy` antes de iniciar. Nunca uses `prisma migrate dev` en
produccion.

Antes de cambios importantes:

1. Crea o confirma un backup de PostgreSQL.
2. Revisa la migracion Prisma incluida en el commit.
3. Despliega y verifica `/health`.
4. Revisa los logs del pre-deploy y del servicio.

## Referencias oficiales

- Railway monorepos: https://docs.railway.com/guides/monorepo
- Railway PostgreSQL: https://docs.railway.com/guides/postgresql
- Railway healthchecks: https://docs.railway.com/reference/healthchecks
- Railway variables: https://docs.railway.com/variables/reference
- Railway Astro: https://docs.railway.com/guides/astro
- Prisma deploy migrations: https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production
