# Impacta

Plataforma de venta de entradas y control de acceso para eventos en Bolivia, del cliente
**Impacta**. Monorepo con dos apps
Next.js que comparten la base de datos y las reglas de negocio.

Integra dos trabajos: el **núcleo transaccional** (reservas sin sobreventa, pagos, entradas
con QR, control de acceso, pruebas) y el **prototipo del compañero** (login, gestión de
eventos, editor y mapa de butacas, sala de espera, diseño visual, datos bolivianos).

```
apps/web       Sitio público: eventos, compra (general y butacas), sala de espera, pago, QR, Mis eventos → :3000
apps/admin     Panel de IMPACTA, boletería, espacio del cliente y API móvil (/api/v1) → :3001
apps/puerta_app App móvil Flutter del portero: QR, código de barras y NFC, con validación sin internet
packages/db    Esquema Prisma, migraciones, operaciones transaccionales y pruebas de integración
packages/core  Reglas puras: dinero, estados, inventario, QR, checkout, geometría de butacas, fechas
docs/          Plan de trabajo, propuesta técnica y decisiones del Sprint 0
```

Stack: TypeScript · Next.js 16 · React 19 · Tailwind 4 · PostgreSQL · Prisma 7 · NextAuth v5 · Turborepo.

## Primer arranque

Requisitos: Node 22.12 o superior. No hace falta Docker ni instalar PostgreSQL.

```bash
npm install
cp .env.example .env      # y reemplaza cada "cambiar" (el archivo explica cómo generarlos)
```

En una terminal aparte, levanta PostgreSQL y déjala abierta:

```bash
npm run db:local
```

Es un PostgreSQL 18 real (binarios oficiales vía npm) en el puerto **5433**, para no chocar con
un PostgreSQL instalado en el 5432. Los datos quedan en `packages/db/.pgdata`. Luego:

```bash
npm run db:deploy
npm run db:seed
npm run dev
```

¿Ya tienes una base con tus propios datos? `npm run db:demo -w @ticketera/db` agrega solo los
datos nuevos (cliente, cajero, puertas por sección, evento con invitados) **sin borrar nada**.

### Cuentas de prueba (las crea `db:seed`, solo desarrollo)

| Dónde | Email | Contraseña | Rol |
|---|---|---|---|
| Panel :3001 | `admin@impacta.test` | `Impacta2026!` | Dueño: todo el panel |
| App móvil | `puerta@impacta.test` | `Puerta2026!` | Portero: solo la app móvil (no entra al panel) |
| Panel :3001 | `caja@impacta.test` | `Caja2026!` | Cajero: solo boletería |
| Panel :3001 | `cliente@impacta.test` | `Cliente2026!` | Cliente (Producciones Andinas): solo sus eventos |
| Panel :3001 | `organizador@andeslive.test` | `Organizador2026!` | Organizador "Andes Live": su propio panel |
| Panel :3001 | `organizador@cumbre.test` | `Organizador2026!` | Organizador "Cumbre Eventos": su propio panel |
| Sitio :3000 | `comprador@impacta.test` | `Comprador2026!` | Comprador (comprar exige cuenta con carnet) |

Cada rol entra directo a su pantalla y no puede abrir las de los demás. El portero no tiene sesión en el panel web.

## Qué probar

1. **Butacas**: http://localhost:3000 → inicia sesión (comprar exige cuenta con carnet; usa `comprador@impacta.test` o crea una) → *La Deliciosa Historia del Xocolate* → Comprar → elige
   butacas en el mapa → Reservar y pagar (pase directo: queda pagada en el acto, sin cobrar) → entradas con QR y butaca, y llegan por correo.
2. **Entrada general y cupo compartido**: *Loko Fest* (Preventa y General comparten el Campo).
3. **Cola virtual**: *Loko Fest* y *Alok* tienen sala de espera. Para verla esperar, baja el
   "cupo simultáneo" de la función a 1 en el panel y entra desde dos navegadores.
5. **Panel**: crea un evento → agrega una función → carga precios por sección → Publicar → aparece en el sitio.
6. **Recintos**: diseña secciones de butacas (grilla o arco) con el editor visual.
7. **Puerta (app móvil)**: en el panel, *Usuarios → Funciones y teléfonos* asigna funciones (y puerta) al
   portero. En cada tipo de entrada se elige cómo se lee en puerta: QR, código de barras y/o NFC. El portero
   inicia sesión en la app (`apps/puerta_app`), elige la función, **descarga los datos** y solo ve los métodos
   que admiten sus entradas. Valida sin internet y sube las lecturas al volver la señal. Una entrada leída por
   un método no admitido se rechaza. En *Loko Fest*, el Acceso sur solo acepta Palco.
8. **Boletería** (cuenta de cajero): vende → ticket para impresora térmica de 80 mm o A4. Comparte
   el cupo con la venta online y sigue vendiendo durante el evento. "Mi caja de hoy" = arqueo.
9. **Lista de invitados**: *Lanzamiento Andino* no se vende ni aparece en el sitio. En la función →
   Invitados: pega la lista desde Excel o sube un CSV; cada invitado tiene su QR (hoja para imprimir).
10. **Cliente**: Clientes → asigna el evento a un cliente → en el evento, "Espacio del cliente" (se
    cierra solo). La cuenta del cliente ve solo sus eventos: reporte en vivo, CSV y sus invitados.
11. **Reporte** (botón en cada evento): por canal, ingresados, ausentes, rechazos en puerta, boletería
    por cajero y medio, y CSV de asistentes.
12. **Usuarios**: crea un operador; al desactivarlo pierde el acceso en la siguiente acción.
13. **Organizadores** (como admin de Impacta): crea uno → entra con su cuenta (pide cambiar la
    contraseña temporal) → su panel está vacío y no ve nada de Impacta ni de los otros. Arma su
    recinto y su evento → "Enviar a revisión" → Impacta lo aprueba o lo devuelve en **Aprobaciones**.
14. **Preventa**: en la función, un tipo de entrada "Es preventa" con fecha de fin. La General de esa
    sección empieza sola cuando termina; la web muestra "Preventa hasta…" y la General "desde…".
15. **Vista general de Impacta**: Resumen general, Ventas e Ingresos en puerta de todos los organizadores.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta las dos apps |
| `npm run check` | Typecheck + lint + tests unitarios. Correr antes de cada commit |
| `npm run test:integration` | Concurrencia, pagos, butacas, cola y acceso contra PostgreSQL real (necesita `db:local`) |
| `npm run build` | Build de producción de las dos apps |
| `npm run db:migrate` | Crea y aplica una migración después de cambiar `schema.prisma` |
| `npm run db:seed` | Borra todo y carga los datos de demostración |
| `npm run db:demo -w @ticketera/db` | Agrega los datos de demostración nuevos sin borrar nada |
| `npm run db:studio` | Explorador visual de la base de datos |

## Cómo funciona lo crítico

- **Inventario**: una orden `PENDING_PAYMENT` no vencida *es* la reserva. Reservar bloquea
  (`SELECT … FOR UPDATE`) los tipos de entrada y sus secciones: las compras simultáneas de lo
  último que queda —o de la misma butaca— se atienden en fila. Respeta el cupo de cada tipo y el
  aforo compartido de la sección. Probado: 60 compras simultáneas sobre 25 lugares venden 25;
  20 personas por la misma butaca, solo una la obtiene.
- **Butacas**: elegirlas en el mapa no las bloquea; se reservan al confirmar, todas o ninguna.
  Así nadie puede acaparar el teatro sin comprar. Un índice único en la base impide emitir dos
  entradas vigentes para la misma butaca y función.
- **Cola virtual**: en Postgres (funciona con varios servidores). El token lo genera el servidor
  (cookie httpOnly) y **la creación de la orden exige un turno vigente**: no se puede saltar
  llamando a la acción directamente. La admisión se serializa: nunca entran más que el cupo.
- **Pagos**: hoy rige el *pase directo* (sin cobro; ver docs/pasarela-de-pago.md). Con una pasarela real, solo el webhook verificado confirma un pago. Idempotente; resuelve el pago tardío
  (si ya no hay cupo o la butaca se vendió, la orden queda expirada y el pago se marca para reembolso).
- **Sesiones**: comprador y staff en tablas, cookies y secretos distintos. El panel verifica el
  rol contra la base en cada acción (una cuenta desactivada pierde el acceso al instante) y no
  tiene registro público: las cuentas las crea un dueño o administrador.
- **Fechas**: el organizador escribe la hora del recinto (La Paz); se guarda en UTC y se muestra
  siempre en la zona del recinto, sin importar dónde corra el servidor.
- **Organizadores**: cada uno es su propia organización; todo (eventos, recintos, ventas, puerta,
  cuentas) cuelga de ella y cada consulta del panel filtra por organización, así que uno nunca ve ni
  toca lo de otro (probado entrando por dirección directa a eventos, reportes y la API de puerta
  ajenos). Impacta es la organización "plataforma": ve todo y puede "entrar" en un organizador para
  trabajar como él. Solo Impacta crea cuentas, siempre con contraseña temporal. Los eventos de un
  organizador salen en la web cuando Impacta los aprueba; uno suspendido no entra ni vende.
- **Canales**: online, boletería e invitaciones descuentan del mismo inventario con la misma
  transacción: nunca se vende de más. Cada orden guarda su canal y quién la emitió.
- **Puerta sin internet**: la app móvil descarga la lista de entradas de la función (completas para su
  puerta, compactas para las demás, sin el secreto del QR) y valida en el teléfono: que el código exista,
  que el método de lectura esté permitido, que sea de su puerta y que no haya entrado. Cada lectura se guarda
  con un id y la hora real, y se sube sola en cuanto hay internet (reenviar no duplica). Si un código no está
  en la lista y hay internet, el servidor decide en el momento (venta posterior a la descarga). Para que
  dos puertas sin internet no acepten la misma entrada, cada puerta tiene sus secciones; si igual ocurre
  (dos lectores en la misma puerta), queda registrado como doble ingreso al sincronizar.
- **App móvil (API `/api/v1`)**: el teléfono inicia sesión con email y contraseña y recibe un token propio
  (solo se guarda su hash). Se revoca desde *Usuarios → Funciones y teléfonos*, y una cuenta desactivada
  pierde el acceso al instante.

## App móvil de puerta (Flutter)

```bash
cd apps/puerta_app
flutter pub get
flutter test && flutter analyze
flutter run --dart-define=API_URL=http://10.0.2.2:3001   # emulador Android → panel local
```

En un teléfono real usa la IP de tu PC (o el dominio https del panel) en `API_URL`, o cámbiala en la
pantalla de login ("Configurar servidor"). Para generar el APK hay que aceptar las licencias de Android
(`flutter doctor --android-licenses`). El NFC lee etiquetas NDEF (texto o enlace) con el código de la entrada;
en iOS requiere el permiso *Near Field Communication Tag Reading* de la cuenta de Apple Developer.

- **Descuento de preventa**: un tipo de entrada puede llevar un porcentaje de descuento con fecha de inicio
  (opcional) y de fin. Es la misma entrada y el mismo cupo: hasta la fecha se cobra el precio con descuento y
  después vuelve al normal solo. El servidor calcula el precio al crear la orden (la web muestra el precio
  normal tachado). Se configura en la función, al agregar o editar el tipo de entrada.

- **Transferir entradas**: en *Mis entradas*, el titular ofrece una entrada a otra persona registrada (por email o
  carnet). Ella la acepta y entonces la entrada pasa a su cuenta con su nombre y su carnet y **recibe un código nuevo**:
  el QR/barras anterior deja de valer, también en las puertas (la app descarga los códigos revocados). Hasta que la
  acepten, la entrada sigue siendo del titular; la oferta vence a las 72 h; máximo 2 transferencias por entrada y hasta
  2 horas antes de la función; el organizador puede desactivarlo por evento. Los dos reciben correo.

- **Límite de intentos**: ingresar (sitio, panel y app de puerta): 20 intentos por IP cada 10 min y, por cuenta, 6
  contraseñas incorrectas cada 15 min (después se bloquea un rato); crear cuentas: 5 por IP por hora; "olvidé mi
  contraseña": 10 por IP por hora; reservas: 8 cada 10 min por cuenta; pedidos de transferencia: 10 por hora. Viven
  en Postgres (`RateLimitHit`) y se ajustan en `packages/db/src/operations/rate-limit.ts`.

- **Códigos promocionales** (panel → *Promociones*): descuento por porcentaje o monto fijo por entrada, para un
  evento o toda la organización, con vigencia, máximo de usos total y por persona, y activar/desactivar. En la compra
  hay un cuadro "Código promocional" (y en boletería): el descuento se ve antes de reservar y queda en la orden. Por
  defecto no se suma al precio de preventa (opción "combinable"). Un código puede llevar el nombre de un **promotor
  (RRPP)** y su comisión: el panel muestra por código y por promotor las entradas vendidas, lo descontado y la comisión
  (solo de ventas pagadas). Un uso se libera si la reserva vence sin pagar; el código y el descuento no se editan una
  vez creados (se desactiva y se crea otro).

## Correo (confirmar email, contraseña y entradas)

El sistema envía cuatro correos: **confirmar el email** (obligatorio para comprar), **cambiar la contraseña**
(compradores y personal del panel), **aviso de contraseña cambiada** y **tus entradas** al pagar (el QR de cada
entrada va como imagen dentro del mensaje, más un botón a "Ver mis entradas"; también se pueden reenviar desde la
orden). Los enlaces sirven una sola vez, vencen (24 h confirmar, 1 h contraseña) y hay un mínimo entre envíos.

- **Desarrollo** (`MAIL_PROVIDER="console"`, por defecto): no se envía nada. Cada correo queda como HTML en
  `.dev-mail/` (ábrelo en el navegador) y el enlace aparece en la consola del servidor.
- **Producción con Resend** (`MAIL_PROVIDER="resend"`): crea una cuenta en https://resend.com, genera una API key
  (`RESEND_API_KEY`), **verifica tu dominio** (registros SPF/DKIM que te indica Resend) y pon el remitente en
  `MAIL_FROM="Impacta <entradas@tudominio.bo>"`. Sin dominio verificado, Resend solo entrega a tu propio correo.
- **Con Gmail** (`MAIL_PROVIDER="smtp"`): sirve para pruebas y un piloto pequeño. Activa la verificación en dos pasos
  de la cuenta, crea una *contraseña de aplicación* y ponla en `SMTP_PASS` (con `SMTP_HOST="smtp.gmail.com"`,
  `SMTP_PORT="465"`, `SMTP_USER="tu-cuenta@gmail.com"`). Límites: unos 500 destinatarios al día en una cuenta
  personal; el remitente real siempre es la cuenta de Gmail (el nombre puede ser `Impacta (no responder)` en
  `MAIL_FROM`, pero la dirección no puede ser `noreply@`); y si Google detecta envíos masivos puede bloquear la cuenta.
  No guardes la contraseña en el repositorio: va solo en el `.env` del servidor.
- Todos los correos dicen "mensaje automático: no respondas". Con `MAIL_REPLY_TO` las respuestas llegan a una dirección de soporte.
- Cambiar de proveedor es agregar una función en `packages/mail/src/send.ts`; nada más del sistema lo sabe.

| Opción | Gratis | Para qué sirve |
|---|---|---|
| **Resend** | 3.000/mes y **100/día** | Lo más simple de integrar. El tope diario se agota con ~100 compras al día: para eventos grandes, plan de pago |
| **Gmail (SMTP)** | ~500/día en cuenta personal | Sirve para pruebas; riesgo de bloqueo con envío automático y sin dirección `noreply@` propia |
| **Brevo** | **300/día** (sin tope mensual) | Más margen diario; lleva marca de Brevo en el plan gratis |
| **Amazon SES** | casi nada (~US$0,10 cada 1.000) | El más barato a volumen; exige más configuración |
| **MailerSend** | 500/mes y 100/día | Muy poco para producción |

Los topes cambian: confirma en la página de precios de cada proveedor antes de decidir.

## Despliegue (Coolify u otro servidor con Nixpacks)

Dos aplicaciones desde este mismo repo (Base Directory `/`) y una base PostgreSQL:

| | Web | Panel |
|---|---|---|
| Port | 3000 | 3001 |
| Build Command | `npx turbo run build --filter=@ticketera/web` | `npx turbo run build --filter=@ticketera/admin` |
| Start Command | `npm run start -w @ticketera/web` | `npm run start -w @ticketera/admin` |
| Pre-deployment | `npm run db:deploy` (migraciones) | — |

Variables en las dos: `DATABASE_URL`, `WEB_URL` (URL pública de la web), `PAYMENT_PROVIDER=directo`,
`NIXPACKS_NODE_VERSION=22` y un secreto aleatorio distinto para `TICKET_QR_SECRET`,
`WEB_AUTH_SECRET` y `ADMIN_AUTH_SECRET`.

Datos de demostración en un servidor nuevo (la semilla **borra todo**; sin `SEED_PASSWORD` se
niega, porque las contraseñas de prueba de arriba son públicas). Desde la terminal de la app web:

```bash
SEED_ALLOW=si SEED_PASSWORD='una-contraseña-propia' npm run db:seed
```

Todas las cuentas de la tabla quedan con esa contraseña.

## Problemas comunes

- **Todas las páginas dan 404 salvo la portada** tras agregar rutas: caché de Turbopack
  desactualizada. Detén `npm run dev`, borra `apps/web/.next` y `apps/admin/.next`, y vuelve a levantar.
- **No se puede mover o borrar una carpeta** en Windows: el servidor de desarrollo la tiene abierta. Detenlo primero.
- **`db:local` falla al iniciar**: revisa que el puerto 5433 esté libre.
- **Dos cuentas del panel a la vez** (ej. admin y puerta): el navegador guarda una sola sesión por
  sitio. Abre la segunda en `http://puerta.localhost:3001` (otro sitio para el navegador, misma app).
  `127.0.0.1` no sirve: Next.js bloquea en desarrollo los orígenes que no sean `localhost`.

## Estado

Ver [docs/sprint-0.md](docs/sprint-0.md): avance por sprint, decisiones tomadas y pendientes.
