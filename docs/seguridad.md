# Seguridad

Qué protege cada capa del sistema, qué configurar en el servidor y qué queda para más adelante.

## Cómo está cerrada la API
La API de la app de puerta (`/api/v1`) y las rutas del sitio no se pueden llamar desde páginas de otros sitios:

| Capa | Qué hace |
|---|---|
| **Origen de las peticiones** | `/api/v1` rechaza (403) toda petición que traiga la cabecera `Origin` (la mandan los navegadores, no la app). El resto de las APIs solo aceptan su propio sitio. Las acciones de formulario las valida Next contra el host. |
| **Identidad en cada petición** | La app usa `Authorization: Bearer` con un token por teléfono. El panel y el sitio usan cookies `httpOnly`, `SameSite=lax` y `secure`, con secretos distintos. Todo se verifica contra la base en cada petición. |
| **Tope de cuerpo** | Login y contraseña: 8 KB. Lote de lecturas: 512 KB. Acciones de formulario: 1 MB. Se corta la lectura al pasarse (no se confía en `Content-Length`). |
| **Límite de intentos** | Por IP y por cuenta en ingresos, registro, olvido de contraseña, renovación de sesión, compras y códigos promocionales (en Postgres). |
| **IP real** | Se toma la IP que vio nuestro proxy (`TRUSTED_PROXY_HOPS`), no el primer valor de `x-forwarded-for`, que el cliente puede inventar. |

> Ninguna API puede garantizar "solo la app original": quien extrae el APK puede imitar sus peticiones. La defensa real es la identidad por petición, la validación del servidor y los límites. Para atar la API a la app original hace falta Play Integrity (al publicar en Play Store).

### Cabeceras de seguridad (sitio y panel)
- **HSTS**: el navegador solo visita el sitio por HTTPS durante un año.
- **CSP**: scripts y estilos solo de este mismo sitio; sin iframes ni plugins; imágenes por https.
- **Anti-iframe** (`X-Frame-Options: DENY` + `frame-ancestors 'none'`): nadie puede incrustar el sitio (clickjacking).
- **nosniff**: el navegador respeta el tipo de archivo declarado.
- **Referrer-Policy**, **Permissions-Policy** (sin cámara, micrófono ni ubicación) y **COOP**.

## Sesiones
- **Web (sitio y panel)**: la sesión es un JWT (30 días en el sitio, 8 horas en el panel) con una *versión de sesión*. Cambiar la contraseña, usar *Cerrar todas las sesiones* (en *Mis datos* o *Cambiar contraseña*) o que un administrador las cierre sube la versión y **todas las sesiones anteriores dejan de valer** en la siguiente petición. Una cuenta desactivada o un organizador suspendido también pierden el acceso al instante.
- **App de puerta**: token de acceso de **60 minutos** + token de renovación de 30 días que **cambia en cada uso**. Si alguien presenta un token de renovación ya usado (robo), la sesión de ese teléfono se cierra y queda una alerta en *Seguridad*. Un reintento dentro de 60 s (se perdió la respuesta) no se toma por robo. Sin internet la app sigue leyendo; renueva sola al reconectar.
- **Lista de teléfonos** (*Usuarios → portero*): modelo, IP, versión de la app, última actividad y botón para cerrar uno o todos.

## Registro de seguridad (pantalla *Seguridad*)
Cada evento guarda **quién, qué, cuándo y desde dónde**: IP, navegador (web) o modelo e identificador del teléfono (app), y el detalle (por ejemplo antes/después de un cambio).

- Ingresos, ingresos fallidos y bloqueos, cierres de sesión, cambios de contraseña, sesiones y teléfonos cerrados, tokens reutilizados.
- **Dispositivo nuevo**: si una cuenta ingresa desde un navegador o teléfono que nunca había usado, el evento queda marcado como alerta.
- Lecturas en puerta (un evento por lote: cuántas entraron y cuántas se rechazaron, y desde qué teléfono).
- Cambios del sistema: cuentas, eventos, recintos, invitados, clientes, transferencias.
- Filtros por tipo, cuenta, IP, fechas y "solo alertas"; tarjetas de las últimas 24 horas e IP con más fallos.
- IMPACTA ve todo; cada organizador solo lo de su organización.
- **Retención**: los eventos de acceso (`auth.*`, `device.*`) se borran a los 12 meses; los de negocio no se borran.

## Configuración del servidor
| Variable | Para qué |
|---|---|
| `TRUSTED_PROXY_HOPS` | Cuántos proxies propios hay delante de la app: `1` con Coolify/Traefik (por defecto), `2` si se agrega Cloudflare. Un valor mayor al real deja que el cliente elija su IP. |
| `WEB_URL` / `ADMIN_URL` | También definen los orígenes permitidos para las APIs. |

Pendiente en la infraestructura (fuera del código): cerrar el puerto público de Postgres, firewall del servidor y, más adelante, Cloudflare (WAF y límites globales).

## Para más adelante
- **Clave de firma propia** del APK (hoy usa la de depuración) y **certificate pinning**: al distribuir la app fuera de los celulares propios.
- **Play Integrity**: al publicar en Play Store, para aceptar solo la app original.
- Aviso por correo de ingreso desde un dispositivo nuevo (hoy queda como alerta en el panel).
