# Sprint 0 — Avance, decisiones y pendientes

## Avance

| Hito del plan | Estado |
|---|---|
| Base técnica (monorepo, modelo de datos, CI) | ✅ |
| Sprint 1 · Login, roles, crear/editar eventos | ✅ NextAuth (staff y compradores), roles OWNER/ADMIN/OPERATOR/CASHIER/CLIENT, eventos, funciones, precios, publicación, usuarios |
| Sprint 2 · Marketplace, carrito, reserva temporal, orden | ✅ Entrada general y butacas, compra como invitado o con cuenta |
| Sprint 3 · Pago, webhooks, idempotencia, emisión, QR | ✅ Con pasarela **simulada**. Falta: pasarela real, email real |
| Sprint 4 · Asientos, concurrencia, cola virtual | ✅ Editor de recintos, mapa del comprador, cola en Postgres. Falta: rate limiting, pruebas de carga |
| Sprint 5 · Validación en puerta, doble ingreso, auditoría | ✅ App móvil Flutter (`apps/puerta_app`): QR, código de barras y NFC según el tipo de entrada; descarga de datos por función/puerta, validación sin internet y sincronización; portero con funciones asignadas; teléfonos revocables |
| Sprint 6 · Reportes, exportaciones, conciliación | 🟡 Reporte por evento (canales, ingresados, ausentes, rechazos, boletería) y CSV de asistentes. Falta: conciliación con la pasarela real |

## Documento de arquitectura IMPACTA (2026-10-02)

Aplicado completo:

- **Varios clientes/organizadores** bajo IMPACTA (`Client`); cada evento se asigna a uno.
- **Espacio temporal del cliente**: IMPACTA lo habilita por evento y se cierra solo (por defecto 24 h
  después de la última función). El cliente ve solo sus eventos: reporte en vivo, CSV y su lista de invitados.
- **Modalidad 2: lista de invitados** (`GUEST_LIST`): sin venta y fuera del sitio público; invitados
  desde Excel (pegar o .xlsx), CSV o a mano; QR único por invitado; anular; hoja de QRs para imprimir.
  En eventos con venta, las cortesías salen del cupo de un tipo de entrada.
- **Boletería (POS)** con rol cajero: efectivo/QR/tarjeta (declarado, sin banco), ticket térmico 80 mm o
  A4, vende durante el evento, arqueo "Mi caja de hoy".
- **App de puerta**: reemplazó al panel web `/puerta` (PWA) por una app móvil Flutter. QR, código de
  barras y NFC según lo configurado en cada tipo de entrada; offline con SQLite y sincronización idempotente,
  puertas por sección; API con tokens por teléfono (`/api/v1`).
- **Registro del dispositivo** en cada lectura; **reportes** de ausentes y rechazos.
- **Mis entradas** (entradas con QR y transferencias) y **Mis eventos** (compras e historial).

## Organizadores y preventa (2026-10-08)

- **Varios organizadores**, cada uno una organización aislada: sus recintos, eventos, ventas, puerta,
  boletería y reportes. Un organizador nuevo empieza vacío. Probado: no ve ni puede abrir nada ajeno.
- **Impacta = plataforma**: Resumen general, Organizadores (alta, suspensión, "Entrar"), Aprobaciones,
  Ventas e Ingresos en puerta de todos, en vivo.
- **Solo Impacta crea cuentas** (de Impacta o de un organizador), con contraseña temporal que se cambia
  al entrar. Cualquier cuenta puede cambiar su contraseña.
- **Revisión**: el organizador envía su evento; Impacta lo aprueba (sale en la web) o lo devuelve con
  una observación.
- **Preventa** por tipo de entrada: fecha de fin (y de inicio opcional); la General empieza sola al
  terminar; en butacas numeradas un solo precio a la vez. Web, boletería y mapa la muestran.
- Se mantiene el modo "Clientes" (Impacta opera el evento y el cliente solo mira).

## Lista de funciones del cliente (2026-10-09)

Hecho:

- **Compradores**: directorio sin repetidos (por email), con compras, entradas, total, canales y eventos;
  búsqueda, orden y filtro por organizador. Impacta ve todos; cada organizador solo los suyos.
- **Exportar a Excel** las ventas (con los filtros aplicados) y los compradores (CSV con `;`, BOM y
  protección contra fórmulas, se abre directo en Excel).
- **Invitados desde .xlsx**: se lee la primera hoja (nombre, email, documento); el .xls antiguo se rechaza
  con instrucciones.
- **Historial** en Mis eventos: cada función pasada dice a qué hora ingresaste, o "no asististe".
  (Las entradas con su QR y la transferencia están en *Mis entradas*.)

Se unió con la rama `feature/puerta-flutter` (2026-10-11): app móvil de puerta, promociones, QR
dinámico, transferencias con aceptación, correo y seguridad vienen de ahí. Quedó su transferencia (más
completa que la que se había hecho aquí) y se quitó la puerta del navegador, reemplazada por la app.

Dejado para después (decisión del cliente): rol de promotor, pasarela de pago real y facturación electrónica.

## Boliches (2026-10-13, rama `feature/boliches`, solo local para la demo)

Los 5 puntos de "Fase 2" del informe del 09/10, sobre lo que ya existía (cada noche es una función: compra,
cola, boletería, puerta, reportes y transferencias funcionan igual):

- **Mesas y lounges**: tipo de entrada "mesa" para N personas; el cupo se cuenta en mesas y cada una ocupa en
  la zona los lugares de todas sus personas. Al pagar recibe su número (Mesa VIP N° 4) y un QR por persona.
- **Consumo mínimo / vales**: consumo incluido por mesa (compartido) o por entrada ("entrada + trago"). Se
  descuenta en **Barra** (panel, también el cajero) leyendo cualquier QR; nunca queda negativo, ni con dos
  barras cobrando a la vez. El comprador ve su saldo en Mis entradas.
- **Noches que se repiten**: "Repetir noches" copia una noche (precios, mesas, horarios, porteros) a los días
  elegidos de las próximas semanas. Sitio: apartado **/boliches** por ciudad y por hoy / este finde / 7 días.
- **Free por horario**: "válida para entrar hasta" (ej. 01:00): una por persona, deja de venderse a esa hora
  y en puerta sale "Fuera de horario". La app móvil la recibe anulada al sincronizar (sin cambiar la app).
- **Promociones de boliche**: códigos RRPP con comisión (los de la rama del compañero) por boliche.

Pendiente si se aprueba: reservar una mesa específica en el mapa, cobro de consumo por QR desde el celular de
la barra (hoy lector USB o código escrito) y reportes de consumo por noche en el reporte del evento.

## Organizadores de solo lectura y boliches como organizador (2026-10-14, rama `feature/boliches`)

- **Dos tipos de usuario** que crea Impacta en *Organizadores*: de **eventos** o de **boliche**. El de boliche
  tiene su panel de noches, mesas, barra, RRPP, ventas e ingresos; el de eventos no ve la barra. Un boliche
  solo crea eventos de categoría Boliche; uno de eventos, todas menos esa.
- **Solo lectura**: las cuentas de organizadores, boliches y clientes ven todo lo suyo en vivo pero no crean ni
  cambian nada (formularios deshabilitados y, en el servidor, `requireEditor` en toda acción que modifica). Solo
  Impacta crea y edita, también dentro de un organizador ("Entrar"). El cajero (boletería y barra) y el portero
  siguen operando. El cliente ya no carga invitados: lo hace Impacta.
- Lounge 360 y Forum Club pasan a ser organizadores tipo boliche, cada uno con organizador (solo lectura),
  cajero y portero.

## Integración con el prototipo del compañero (2026-10-01)

**Se trajo:**
- Login de las dos apps (NextAuth v5, cookies y secretos separados).
- Formularios de eventos, funciones y tipos de entrada, con su regla de publicación.
- Editor visual de butacas (grilla y arco) y su geometría.
- Mapa del comprador y pantalla de la sala de espera.
- Diseño visual de ambas apps, categorías y eventos de ejemplo de Bolivia.

**Se corrigió en el camino:**

| Problema del prototipo | Solución |
|---|---|
| Migraciones con una línea de consola en el SQL (no aplicaban en una base vacía) | Se usan las migraciones de este repo, verificadas en CI |
| La cola se podía saltar (la acción de compra no verificaba el turno) | `createPendingOrder` exige turno vigente |
| La cola vivía en memoria (un solo servidor) y reordenaba toda la fila por request | Postgres + admisión serializada + posición por índice |
| El token de la cola lo elegía el navegador | Lo genera el servidor (cookie httpOnly) |
| Registro público de organizadores | Cuentas del panel creadas por OWNER/ADMIN en Usuarios |
| Fechas interpretadas y mostradas en la zona del servidor | Hora del recinto → UTC (`zonedDateTimeToUtc`), siempre se muestra en la zona del recinto |
| Butacas bloqueadas una por una al hacer clic (permite acaparar) | Se reservan todas juntas al confirmar, en una transacción |
| Mapa de butacas duplicado por función | Se diseña una vez por recinto; el precio va por función |
| Butacas de ejemplo sin posición (todas en 0,0) | La semilla usa la misma geometría que el editor |

## Tomadas (revisables)

| Decisión | Motivo |
|---|---|
| **País: Bolivia** (BOB, `es-BO`, `America/La_Paz`) | Confirmado por el prototipo y la zona horaria del equipo. |
| **NextAuth v5 (beta 32, versión fija)** | Lo pide la propuesta y el prototipo ya lo usaba. Alternativa a evaluar: Better Auth (Auth.js está en mantenimiento). |
| Prisma 7.10, TypeScript 6.0, ESLint 9 | Versiones estables compatibles entre sí. |
| PostgreSQL local embebido (puerto 5433) | Postgres real sin Docker, para probar concurrencia de verdad. |
| Orden pendiente = reserva; disponibilidad con bloqueo de fila | Sin contadores que desincronizar ni cron obligatorio. |
| Reserva de **10 minutos**; turno de cola de **10 minutos** | **Confirmar con el cliente.** |
| Cargo por servicio = 0 | **Confirmar con el cliente.** |
| Pasarela simulada detrás de una interfaz | Permite probar todo el flujo antes de tener la real. |
| QR firmado con HMAC (`TK1`) | El servidor verifica la firma. Offline el celular valida contra la lista descargada (no lleva el secreto). |
| Espacio del cliente: 24 h después de la última función | Editable por evento. **Confirmar con el cliente.** |
| Boletería: el medio de pago se declara | Sin conexión al banco ni al POS de tarjetas. Vende hasta el fin de la función (o 4 h después del inicio). |
| Doble ingreso offline: se evita asignando secciones a puertas | Dos equipos sin internet en la misma puerta podrían aceptar la misma entrada; queda registrado al sincronizar. |

## Pendientes (cerrar con el cliente)

- [ ] **Pasarela de pago real para Bolivia.** Mercado Pago **no opera en Bolivia**. Se necesita una pasarela autorizada por el BCB que acepte **QR interoperable** (el medio dominante) y tarjetas. Iniciar el trámite ya.
- [ ] **Facturación electrónica** (SIN, Bolivia) y datos que pide la factura (NIT / carnet).
- [ ] **Email transaccional**: proveedor y dominio (SPF/DKIM). Hoy se escribe en la consola.
- [ ] **Rate limiting** en login, registro, cola y compra (hoy no hay límites por IP).
- [ ] **Pruebas de carga** de la cola y la compra con volúmenes reales.
- [ ] **Conciliación** de pagos con la pasarela real.
- [ ] **https** en el entorno de pruebas: la cámara del celular no funciona por http en la red local.
- [ ] **Invitación por email** al crear un organizador o una cuenta (hoy se le pasa la contraseña temporal a mano).
- [ ] **Comisión de Impacta** por organizador y liquidaciones (cuánto se le paga a cada uno).
- [ ] **Editor de butacas**: editar/mover secciones existentes, zoom, deshacer (mejoras ya conversadas con el cliente; propuesta: Konva.js).
- [ ] **Recuperar contraseña** y verificación de email.
- [ ] **Hosting**: Vercel + Postgres administrado con pooler de conexiones.
- [ ] **Alcance MVP congelado y aprobado.**
