# Sprint 0 — Avance, decisiones y pendientes

## Avance

| Hito del plan | Estado |
|---|---|
| Base técnica (monorepo, modelo de datos, CI) | ✅ |
| Sprint 1 · Login, roles, crear/editar eventos | ✅ NextAuth (staff y compradores), roles OWNER/ADMIN/OPERATOR, eventos, funciones, precios, publicación, usuarios |
| Sprint 2 · Marketplace, carrito, reserva temporal, orden | ✅ Entrada general y butacas, compra como invitado o con cuenta |
| Sprint 3 · Pago, webhooks, idempotencia, emisión, QR | ✅ Con pasarela **simulada**. Falta: pasarela real, email real |
| Sprint 4 · Asientos, concurrencia, cola virtual | ✅ Editor de recintos, mapa del comprador, cola en Postgres. Falta: rate limiting, pruebas de carga |
| Sprint 5 · Validación en puerta, doble ingreso, auditoría | ✅ Online, lector USB o código manual, operador registrado. Falta: cámara del celular, offline |
| Sprint 6 · Reportes, exportaciones, conciliación | ⏳ Pendiente |

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
| QR firmado con HMAC (`TK1`) | Validación online. Si se requiere offline → Ed25519 (`TK2`). |

## Pendientes (cerrar con el cliente)

- [ ] **Pasarela de pago real para Bolivia.** Mercado Pago **no opera en Bolivia**. Se necesita una pasarela autorizada por el BCB que acepte **QR interoperable** (el medio dominante) y tarjetas. Iniciar el trámite ya.
- [ ] **Facturación electrónica** (SIN, Bolivia) y datos que pide la factura (NIT / carnet).
- [ ] **Email transaccional**: proveedor y dominio (SPF/DKIM). Hoy se escribe en la consola.
- [ ] **Rate limiting** en login, registro, cola y compra (hoy no hay límites por IP).
- [ ] **Pruebas de carga** de la cola y la compra con volúmenes reales.
- [ ] **Lector con cámara del celular** (y si hace falta, offline).
- [ ] **Reportes**, exportaciones y conciliación con la pasarela.
- [ ] **Editor de butacas**: editar/mover secciones existentes, zoom, deshacer (mejoras ya conversadas con el cliente; propuesta: Konva.js).
- [ ] **Recuperar contraseña** y verificación de email.
- [ ] **Hosting**: Vercel + Postgres administrado con pooler de conexiones.
- [ ] **Alcance MVP congelado y aprobado.**
