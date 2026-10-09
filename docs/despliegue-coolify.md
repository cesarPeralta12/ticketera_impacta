# Despliegue en Coolify

Qué hay que tener y en qué orden. Son **dos aplicaciones** (sitio y panel) del mismo repositorio, **una base PostgreSQL** y, aparte,
la **app de puerta** (APK) que se instala en los celulares.

## 0. Antes de empezar
| Qué | Para qué |
|---|---|
| Dos dominios (o subdominios) con HTTPS: `tudominio.bo` (sitio) y `panel.tudominio.bo` (panel) | La cámara del celular y las cookies seguras exigen HTTPS. Coolify emite el certificado solo |
| El dominio verificado en **Resend** (registros SPF/DKIM) y una API key | Correos de confirmar email, contraseña y entradas |
| El repositorio accesible desde Coolify (GitHub) | Construir las apps |
| Una contraseña y un correo para el primer dueño | Entrar al panel la primera vez |

## 1. Base de datos
1. En Coolify: *New Resource → Database → PostgreSQL* (17 o superior), con **volumen persistente**.
2. Copia la *Internal URL* (`postgresql://usuario:clave@host:5432/db`): es la `DATABASE_URL`.
3. Activa las **copias de seguridad programadas** (diarias) hacia almacenamiento externo (S3/Backblaze). Prueba restaurar una vez.

## 2. Las dos aplicaciones
Crea dos *Applications* desde el mismo repositorio (Base Directory `/`, build pack Nixpacks, rama `main`):

| | Sitio (web) | Panel (admin) |
|---|---|---|
| Dominio | `https://tudominio.bo` | `https://panel.tudominio.bo` |
| Port | 3000 | 3001 |
| Build Command | `npx turbo run build --filter=@ticketera/web` | `npx turbo run build --filter=@ticketera/admin` |
| Start Command | `npm run start -w @ticketera/web` | `npm run start -w @ticketera/admin` |
| Pre-deployment Command | `npm run db:deploy` | — (las migraciones las aplica el sitio) |
| Health check (ruta) | `/api/health` | `/api/health` |

### Variables de entorno
Las mismas en las dos (salvo donde se indica). Los secretos se generan con
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` y **no se cambian después**
(`TICKET_QR_SECRET`: si cambia, los QR ya emitidos dejan de valer).

| Variable | Valor |
|---|---|
| `NIXPACKS_NODE_VERSION` | `22` |
| `DATABASE_URL` | la de la base (paso 1) |
| `WEB_URL` | `https://tudominio.bo` |
| `ADMIN_URL` | `https://panel.tudominio.bo` |
| `TICKET_QR_SECRET` | secreto aleatorio, **el mismo en las dos apps** |
| `WEB_AUTH_SECRET` | secreto aleatorio (solo importa en el sitio) |
| `ADMIN_AUTH_SECRET` | otro secreto aleatorio, distinto (solo importa en el panel) |
| `PAYMENT_PROVIDER` | `directo` (**no cobra**; ver `docs/pasarela-de-pago.md`) |
| `MAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | la key de Resend |
| `MAIL_FROM` | `IMPACTA <noreply@tudominio.bo>` |
| `MAIL_REPLY_TO` | (opcional) dirección de soporte |

Con `PAYMENT_PROVIDER=directo` cualquiera puede "comprar" sin pagar: sirve para pruebas y para eventos de invitación, no para vender.

## 3. Primer arranque
1. Despliega **primero el sitio**: su *Pre-deployment Command* aplica las migraciones (`npm run db:deploy`). Luego el panel.
2. Crea la plataforma y su primer dueño desde la terminal de la app del sitio en Coolify. **No borra nada** y se puede repetir:
   ```bash
   BOOTSTRAP_EMAIL=tu@correo.com BOOTSTRAP_NAME="Tu Nombre" npm run db:bootstrap
   ```
   Imprime una contraseña temporal una sola vez. Entra al panel con ella: te pide cambiarla.
3. **No uses `npm run db:seed` en producción**: es la semilla de demostración y **borra todo**.
4. En el panel: crea los organizadores (*Organizadores*), sus recintos y eventos, y los porteros (*Usuarios*), asignándoles función y puerta.

## 4. Revisión después de desplegar
- `https://tudominio.bo/api/health` y `https://panel.tudominio.bo/api/health` responden `{"ok":true}`.
- Crear una cuenta en el sitio con un correo real: llega el correo de confirmar (si no, revisar `MAIL_FROM`, el dominio en Resend y los registros DNS).
- Comprar una entrada de un evento de prueba: llega el correo con el QR y se ve en *Mis entradas*.
- Entrar al panel, ver *Ingresos en puerta* y el ingreso en vivo de la función.

## 5. App de puerta (celulares)
1. Compilar apuntando al panel (necesita el SDK de Android, ver README):
   ```bash
   cd apps/puerta_app
   flutter build apk --release --dart-define=API_URL=https://panel.tudominio.bo
   ```
   El APK queda en `build/app/outputs/flutter-apk/app-release.apk`. Hoy se firma con la clave de depuración, suficiente para instalarlo
   directo en los celulares de la puerta (activando "instalar apps desconocidas"); para Google Play hace falta una clave de firma propia.
2. En cada celular: instalar, entrar con la cuenta del portero (una por puerta) y descargar los datos **antes** del evento con wifi.
3. iPhone: se compila con el mismo código desde una Mac con Xcode y una cuenta de Apple Developer (el NFC pide un permiso extra de Apple).

## 6. Operación
- **Actualizar**: push a `main` y *Redeploy* en Coolify (las migraciones corren solas en el sitio). Las migraciones son aditivas.
- **Copias**: verificar que las copias de la base se estén haciendo; guardar los secretos (sobre todo `TICKET_QR_SECRET`) en un gestor de contraseñas.
- **Límite de correos**: Resend gratis permite 100 al día; pasar al plan de pago antes de un evento con venta fuerte.
- **Antes de un evento**: descargar los datos en cada celular la víspera y 1–2 horas antes, probar un teléfono de repuesto por puerta.
