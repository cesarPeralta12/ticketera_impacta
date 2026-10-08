# Sprint 0 — Avance, decisiones y pendientes

## Avance

| Hito del plan | Estado |
|---|---|
| Base técnica (monorepo, modelo de datos, CI) | ✅ |
| Sprint 1 · Login, roles, crear/editar eventos | ✅ NextAuth (staff y compradores), roles OWNER/ADMIN/OPERATOR/CASHIER/CLIENT, eventos, funciones, precios, publicación, usuarios |
| Sprint 2 · Marketplace, carrito, reserva temporal, orden | ✅ Entrada general y butacas, compra como invitado o con cuenta |
| Sprint 3 · Pago, webhooks, idempotencia, emisión, QR | ✅ Con pasarela **simulada**. Falta: pasarela real, email real |
| Sprint 4 · Asientos, concurrencia, cola virtual | ✅ Editor de recintos, mapa del comprador, cola en Postgres. Falta: rate limiting, pruebas de carga |
| Sprint 5 · Validación en puerta, doble ingreso, auditoría | ✅ App de puerta instalable: cámara, NFC (Android), lector USB, manual; offline con sincronización; puertas por sección; equipo registrado en cada lectura |
| Sprint 6 · Reportes, exportaciones, conciliación | 🟡 Reporte por evento (canales, ingresados, ausentes, rechazos, boletería) y CSV de asistentes. Falta: conciliación con la pasarela real |

## Documento de arquitectura IMPACTA (2026-10-02)

Aplicado completo:

- **Varios clientes/organizadores** bajo IMPACTA (`Client`); cada evento se asigna a uno.
- **Espacio temporal del cliente**: IMPACTA lo habilita por evento y se cierra solo (por defecto 24 h
  después de la última función). El cliente ve solo sus eventos: reporte en vivo, CSV y su lista de invitados.
- **Modalidad 2: lista de invitados** (`GUEST_LIST`): sin venta y fuera del sitio público; invitados
  desde Excel (pegar), CSV o a mano; QR único por invitado; anular; hoja de QRs para imprimir.
  En eventos con venta, las cortesías salen del cupo de un tipo de entrada.
- **Boletería (POS)** con rol cajero: efectivo/QR/tarjeta (declarado, sin banco), ticket térmico 80 mm o
  A4, vende durante el evento, arqueo "Mi caja de hoy".
- **App de puerta** (`/puerta`, PWA instalable): cámara (nativa en Android, jsQR en iPhone), NFC en
  Android, lector USB/manual, offline con IndexedDB y sincronización idempotente, puertas por sección.
- **Registro del dispositivo** en cada lectura; **reportes** de ausentes y rechazos.
- "Mis entradas" → **"Mis eventos"** (el enlace viejo redirige).

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
- [ ] **Excel nativo (.xlsx)** para invitados, si pegar o CSV no alcanza.
- [ ] **Invitación por email** al crear un organizador o una cuenta (hoy se le pasa la contraseña temporal a mano).
- [ ] **Comisión de Impacta** por organizador y liquidaciones (cuánto se le paga a cada uno).
- [ ] **Editor de butacas**: editar/mover secciones existentes, zoom, deshacer (mejoras ya conversadas con el cliente; propuesta: Konva.js).
- [ ] **Recuperar contraseña** y verificación de email.
- [ ] **Hosting**: Vercel + Postgres administrado con pooler de conexiones.
- [ ] **Alcance MVP congelado y aprobado.**
