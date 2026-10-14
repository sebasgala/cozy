# Despliegue de la API (Render y Docker)

La API se empaqueta en una imagen de Docker (`Dockerfile`, multi-etapa). Al arrancar aplica las migraciones
pendientes y luego inicia la aplicación; si una migración falla, el contenedor no arranca.

## Variables de entorno

Plantilla completa en `.env.example`. En Render se definen en el panel (Environment), nunca dentro de la imagen.

| Variable | Obligatoria | Para qué |
|---|---|---|
| `NODE_ENV` | sí en producción | `production`. La imagen ya la trae puesta. Activa SSL hacia la base |
| `PORT` | no | Puerto de la API (3000 por defecto). Render lo define solo |
| `DATABASE_URL` | sí* | `postgresql://usuario:clave@host:5432/base` (Render la entrega así) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | alternativa | Solo se usan si `DATABASE_URL` está vacía (`DB_PORT` es opcional, 5432) |
| `DATABASE_SSL` | no | `true` o `false` para forzar o apagar SSL. Sin definir: activo solo si `NODE_ENV=production` |
| `JWT_SECRET` | sí | Mínimo 32 caracteres. Sin él la aplicación no arranca |
| `CORS_ORIGIN` | sí en producción | URLs del frontend separadas por comas, sin barra final |
| `TRUST_PROXY` | sí en Render | `1`: usa la IP real del cliente detrás del proxy de Render |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | solo al correr el seed | Superadmin inicial (contraseña de 8 a 72 caracteres) |

\* o el conjunto `DB_*`.

Generar un `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### CORS

- Métodos: `GET`, `POST`, `PATCH`, `DELETE`. Cabeceras: `Authorization`, `Content-Type`, `Idempotency-Key`. Se expone `Retry-After`.
- Con `CORS_ORIGIN` definido, solo esos orígenes (y, fuera de producción, `http://localhost:5173`).
- Sin `CORS_ORIGIN`, ningún origen salvo `localhost` / `127.0.0.1`.
- `*` no se acepta: la aplicación no arranca.
- Un origen no permitido recibe la respuesta sin cabeceras CORS y el navegador la bloquea. Las peticiones sin cabecera `Origin` (curl, servidor a servidor) pasan.
- `PUT` no está permitido para el navegador: para modificar un alojamiento el frontend usa `PATCH`.

### TRUST_PROXY

Detrás de Render todas las peticiones llegan desde el proxy. Sin `TRUST_PROXY=1`, el límite de intentos de login
(5 por minuto por correo e IP) vería una sola IP para todos los clientes. Con `1` usa la IP real de `X-Forwarded-For`.
Valores: `false` (por defecto), `true`, un número de saltos o una lista de IP/subredes.

## Render

1. Crear una base **PostgreSQL** y copiar su *Internal Database URL* (misma región que la API).
2. Crear un **Web Service** de tipo Docker apuntando al repositorio (usa el `Dockerfile` de la raíz).
3. Definir las variables: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `TRUST_PROXY=1`. `NODE_ENV` y `PORT` ya vienen resueltos.
   - La URL interna de Render no siempre exige SSL; si la conexión se rechaza por eso, pon `DATABASE_SSL=false`.
4. *Health Check Path*: `/api/v1/health`. Responde 200 si la API y la base contestan, y 503 si la base no responde.
5. Cada despliegue aplica solo las migraciones nuevas antes de iniciar.

## Seed (una vez en producción)

El seed crea el superadmin y **carga datos de demostración** (3 ciudades, 5 alojamientos, 12 habitaciones y
60 días de disponibilidad). Se corre una sola vez y a mano, desde la *Shell* del servicio en Render (o con
`docker exec`), con las dos variables del superadmin:

```bash
SUPERADMIN_EMAIL=correo@ejemplo.com SUPERADMIN_PASSWORD='una-clave-larga' npm run seed:prod
```

- Si faltan las variables, falla con un mensaje claro y no toca la base.
- Repetirlo no duplica nada ni cambia la contraseña del superadmin; solo agrega los días de disponibilidad que falten.
- Cuando el superadmin ya existe, quita `SUPERADMIN_PASSWORD` del panel.
- Si no quieres los datos de demostración en producción, crea el superadmin y los alojamientos reales por otra vía antes de usar el seed; hoy no hay una opción para saltarse los datos de ejemplo.

(En desarrollo sigue siendo `npm run seed`, que además compila.)

## Probar la imagen en local

```bash
docker-compose up -d                        # PostgreSQL de desarrollo
docker build -t cozy-api .
docker run --rm -p 3100:3000 --add-host host.docker.internal:host-gateway \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/booking_db \
  -e DATABASE_SSL=false -e JWT_SECRET=<32+ caracteres> -e CORS_ORIGIN=http://localhost:5173 cozy-api
curl http://localhost:3100/api/v1/health
```

Con `NODE_ENV=production` y sin `DATABASE_SSL=false`, el PostgreSQL de `docker-compose` rechaza la conexión porque no ofrece SSL.

## Comandos de npm

| Comando | Qué hace |
|---|---|
| `npm run migration:run:prod` | Aplica migraciones con el build ya compilado (no necesita herramientas de desarrollo) |
| `npm run start:migrate` | `migration:run:prod` y luego `node dist/main` (para Render sin Docker) |
| `npm run seed:prod` | Seed con el build ya compilado |

## Pendientes

- Falta una cabecera de seguridad HTTP (por ejemplo `helmet`); no se instaló sin consultarlo.
- `rejectUnauthorized: false` en SSL: cifra la conexión pero no valida el certificado de la base. Es lo habitual con Render; para validarlo habría que aportar el certificado de la autoridad.
