# Impacta — Mejoras propuestas para todo el sistema

Propuesta, no implementada. Surge de revisar el sistema completo después de fusionar el modelo de
organizadores con la app móvil de puerta. Prioridad: **P0** antes de vender entradas reales,
**P1** antes del primer evento grande, **P2** mejora continua. Los esfuerzos son orientativos.

## 0. Hallazgos de la revisión (cosas que ya encontramos)

| Hallazgo | Dónde | Acción |
|---|---|---|
| La semilla no marcaba a Impacta como plataforma (solo la migración lo hacía): un `db:seed` sobre base nueva dejaba a Impacta sin vista general | `seed.ts` | **Corregido** en la fusión |
| Los teléfonos seguían leyendo entradas con un organizador suspendido | `authenticateDevice` | **Corregido** |
| La descarga "delta" se calcula por fechas (`issuedAt/usedAt/cancelledAt`): no ve otros cambios (transferencias, cambios de tipo) y depende de relojes | `getDoorDownload` | Ver 3.3 |
| El teléfono valida que el código exista, no su firma (el secreto no está en el teléfono) | `validator.dart` | Ver 3.5 |
| Avisos de saltos de línea CRLF/LF en cada commit | repo | Agregar `.gitattributes` (`* text=auto eol=lf`) |
| Existen dos modelos de "cliente": `Client`/rol `CLIENT` (espacio temporal) y organizaciones aisladas | esquema | Ver 1.3 |

## 1. Identidad, cuentas y organizadores

1. **P0 · Login y carnet obligatorios para comprar.** Hoy se compra como invitado y el carnet es opcional.
   La compra toma nombre, email y carnet de la cuenta; el carnet es único por persona (evita reventa con
   cuentas múltiples). Verificación de email y recuperar contraseña.
2. **P0 · Límite de intentos** (rate limiting) en login, registro, cola, compra, API móvil y lectura
   manual de códigos; bloqueo temporal por cuenta/IP.
3. **P1 · Un solo modelo de organizador.** Retirar `Client` y el rol `CLIENT` (espacio temporal) a favor de
   organizaciones aisladas, con roles internos: dueño, administrador, **solo lectura** (reportes) y personal.
4. **P1 · Auditoría visible.** Pantalla de registro de acciones (quién aprobó, suspendió, entró como,
   cambió precios, anuló entradas). Ya se guarda; falta mostrarlo y filtrarlo.
5. **P1 · Contraseñas y sesiones.** Política de contraseñas, cierre de sesión en todos los dispositivos,
   aviso de nuevo inicio de sesión, doble factor opcional para Impacta y organizadores.
6. **P2 · Invitar por enlace** a porteros y cajeros (enlace de un solo uso en vez de contraseña temporal).

## 2. Compra, pagos y negocio

1. **P0 · Pasarela de pago real para Bolivia** (QR interoperable autorizado por el BCB + tarjetas) con
   conciliación diaria y reembolsos. Mercado Pago no opera en el país.
2. **P0 · Facturación electrónica (SIN)** con NIT/carnet del comprador.
3. **P0 · Correo transaccional** (entrada, recordatorios, transferencias) con SPF/DKIM; **WhatsApp** como
   canal principal de entrega y recordatorio (más usado que el correo en Bolivia).
4. **P1 · Modelo comercial por organizador:** comisión (porcentaje o fija), quién la paga, liquidación por
   organizador y por evento (ventas, comisión, neto, fecha de pago) y exportación a Excel.
5. **P1 · Transferir o asignar entradas** (pedido 6): titular por entrada, transferencia a otra cuenta con
   aceptación, el código anterior se anula al transferir, reglas por evento (cantidad y hasta cuándo).
6. **P1 · Zonas de pie con "restantes"** y cupo por función; administrador de recintos más claro
   (duplicar, archivar, editar secciones, deshacer/zoom en el editor).
7. **P2 · Cupones, entradas por lote para empresas, listas de espera por agotado, reembolso parcial.**

## 3. Puerta y app móvil

1. **P0 · Pruebas en campo** con 3 teléfonos en modo avión, cámara y NFC reales, y un ensayo con el
   estadio lleno de lecturas simultáneas. Hasta ahora está probado en servidor y con un celular.
2. **P1 · Sincronización en segundo plano** (servicio de Android) para subir ingresos aunque la app no esté
   abierta; hoy sube mientras la app está en pantalla.
3. **P1 · Cambios por versión, no por fecha.** Una tabla de cambios con número creciente por función
   (`version`) y descarga `?desde=<n>`: incluye anulaciones, transferencias y ediciones, sin depender de relojes.
   Comprimir la descarga (gzip) y paginarla.
4. **P1 · Dos lectores en la misma puerta sin internet.** Hoy se detecta el doble ingreso al sincronizar.
   Sincronización local entre lectores de la misma puerta (red local o Bluetooth), o lector principal.
5. **P1 · Firmas asimétricas (TK2, Ed25519).** El teléfono verifica la firma sin guardar secretos: una
   entrada inventada ya no pasa ni offline; un teléfono robado no puede fabricar entradas.
6. **P1 · Seguridad del teléfono.** Base local cifrada (SQLCipher), bloqueo con PIN/huella al abrir la
   app, tokens de menor duración (por jornada) con renovación, y borrado remoto de datos al revocar.
7. **P1 · Grabador de pulseras NFC** en la app (para administradores): escribe el código de la entrada en
   la etiqueta NDEF; hoy la lectura funciona pero no hay cómo grabar.
8. **P2 · Experiencia del portero:** sonidos distintos por resultado, vibración, modo de alto contraste,
   contador por sector en pantalla, modo "evento lleno" y reintento automático.
9. **P2 · iOS** (cámara, NFC con permiso de Apple), distribución con firma y actualización interna;
   reporte de fallos (Crashlytics/Sentry).
10. **P2 · QR dinámico opcional ("modo seguro")** para eventos de alto riesgo de reventa: secreto por
    entrada en la descarga y QR que cambia en la cuenta del comprador, verificable también offline.

## 4. Panel y reportes

1. **P1 · Ingreso en vivo escalable.** La vista actual recarga todo cada 5 s; para 20 000 entradas pasar a
   actualizaciones incrementales (SSE/WebSocket) y a un resumen en la base, con paginación y búsqueda.
2. **P1 · Operación del día del evento:** entradas por minuto por puerta, alerta de muchos rechazos, aforo
   por sector, "quién no ha llegado" y exportación (Excel/PDF) de ingresos y rechazos.
3. **P1 · Tablero del organizador:** ventas por día, por tipo y canal, embudo (visitas → carrito → pago),
   estadísticas de la cola y comparación con eventos anteriores.
4. **P2 · Impresión:** plantillas de ticket (logo del organizador), formatos térmico/A4/carta ya disponibles;
   guardar el formato elegido por usuario.
5. **P2 · Accesibilidad y móvil:** el panel funciona en pantallas pequeñas, pero faltan pruebas con lector
   de pantalla, teclado y contraste.

## 5. Plataforma, calidad y operación

1. **P0 · Copias de seguridad** automáticas de la base (con prueba de restauración), secretos fuera del
   repositorio, validación de variables de entorno al arrancar.
2. **P0 · Pruebas de carga** de cola y compra (k6) y de descarga/subida de la app con 20 000 entradas.
3. **P1 · Contrato de la API** (OpenAPI generado de los esquemas) y cliente Dart generado; pruebas de
   contrato entre la app y el servidor para que un cambio no rompa los teléfonos instalados.
4. **P1 · Pruebas de extremo a extremo** (Playwright): comprar → entrada → lectura → ingreso en vivo.
5. **P1 · Observabilidad:** registros estructurados, métricas (compras/min, lecturas/min, errores),
   alertas y panel de salud; correo/Sentry para errores.
6. **P1 · Entornos y despliegue:** staging con datos de prueba, migraciones compatibles hacia atrás,
   publicación automática de la APK firmada desde la integración continua.
7. **P1 · Datos personales:** el carnet es dato personal. Política de privacidad, cifrado en reposo,
   acceso mínimo (el organizador ve el carnet solo de sus eventos), retención y borrado.
8. **P2 · Rendimiento:** caché de páginas públicas de eventos, imágenes optimizadas con CDN, índices
   revisados con datos reales (lecturas por función y estado).

## 6. Orden sugerido

1. **Antes de vender de verdad (P0):** login y carnet, límites de intentos, pasarela, factura, correo y
   WhatsApp, copias de seguridad, pruebas de carga y pruebas en campo de la app.
2. **Antes del primer evento grande (P1):** transferencia de entradas, zonas con "restantes", liquidación por
   organizador, firmas TK2 y base cifrada en el teléfono, sincronización en segundo plano, ingreso en vivo
   incremental, contrato de la API y pruebas de extremo a extremo.
3. **Mejora continua (P2):** iOS, QR dinámico opcional, cupones, tableros y accesibilidad.

**Guía de día del evento (para el equipo):** descargar los datos de cada puerta la víspera y 1–2 h antes con
wifi; probar un teléfono de repuesto por puerta; llevar la lista impresa de contingencia; al terminar,
confirmar que no queden lecturas pendientes y revisar el panel de ingresos y rechazos.
