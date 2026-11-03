# Cashless en iPass — Cómo se aplicaría

Propuesta para sumar pagos sin efectivo (saldo recargable y consumo con QR o manilla NFC) a iPass, tomando como referencia el
sistema Cashless de Colpa Caranda (`D:\Trabajo\Colpacarandaa\COMO_FUNCIONA.md`).

Estado: **propuesta, nada implementado.** Las estimaciones de tiempo son orientativas y hay que validarlas con el cliente.

---

## 1. Resumen

- iPass ya resuelve la mitad del problema: identidad del comprador, pagos, QR (incluido el dinámico), personal con roles,
  app móvil que trabaja **sin internet** y un vale de consumo en barra.
- Lo que falta es un **monedero (saldo) con libro de movimientos**, **puntos de cobro** y una forma de **identificar al portador**
  en el punto de venta: su QR o una manilla NFC.
- Recomendación: empezar **con QR (sin hardware)** y dejar la **manilla NFC como segunda fase**, porque el modelo de datos y
  los flujos son los mismos y solo cambia cómo se lee la identidad.
- El mayor riesgo no es técnico: es **regulatorio y contable** (guardar saldo de clientes, devoluciones, facturación). Se trata
  en la sección 9.

---

## 2. Qué es distinto entre Colpa Caranda y iPass

| | Colpa Caranda (resort) | iPass (eventos y boliches) |
|---|---|---|
| Duración del saldo | Días de estadía | Una noche o un evento |
| Quién recarga | Recepción, en persona | Online antes del evento, en puerta y en barra |
| Identidad | Huésped con manilla asignada en recepción | Comprador con cuenta y entradas ya emitidas |
| Volumen | Cientos de personas a lo largo de días | Miles de personas **en pocas horas** |
| Pico de uso | Repartido | Muy concentrado (barras llenas, filas) |
| Conectividad | Wi-Fi del resort | Variable; en recintos grandes, mala |
| Cierre | Checkout con devolución del saldo | Fin de la noche: ¿se devuelve, caduca o se transfiere? |

Consecuencia: en iPass pesa mucho más la **velocidad de cobro**, el **modo sin internet** y la **regla de saldo sobrante**.

---

## 3. Lo que iPass ya tiene y se reutiliza

| Necesidad cashless | Ya existe en iPass |
|---|---|
| Identidad del comprador | `Customer`, `Order`, `Ticket`; cuenta y «Mis entradas» |
| Pagar online | `Payment`, `startPayment`, `applyPaymentUpdate`, webhooks idempotentes (`docs/pasarela-de-pago.md`) |
| Identificar al portador sin internet | QR dinámico firmado, validación local (`docs/qr-dinamico.md`) |
| Personal con permisos acotados | `StaffRole` (incluye `BAR`), asignación por noche |
| App móvil con cola offline | `apps/puerta_app` (sincronización de un solo vuelo, conflictos «gana el primero») |
| Consumo en barra | `ConsumptionCredit` y `ConsumptionRedemption` (vale de un solo uso) |
| Auditoría | `AuditLog` |
| Reportes por función/noche | `getEventReport` |

**Lo que no sirve tal cual:** `ConsumptionCredit` es un **vale de un solo uso** con saldo fijo (se lee una vez y queda marcado).
Un cashless necesita un saldo que **sube y baja muchas veces**. Conviene un modelo nuevo y dejar el vale como está (o migrarlo
después a una sola mecánica).

---

## 4. Principio de diseño

Igual que en Colpa Caranda: **el identificador no guarda dinero; el saldo vive en la base de datos.**

- El QR o la manilla solo identifican a la persona (o a su monedero).
- Cada cobro consulta o descuenta contra el servidor, o contra el **saldo cacheado del teléfono** si no hay internet (ver 7).
- Si se pierde una manilla o se filtra un QR no se pierde dinero: se bloquea el identificador y el saldo pasa a otro.

---

## 5. Modelo de datos propuesto

Nuevas tablas (nombres tentativos, en `packages/db/prisma/schema.prisma`):

| Modelo | Para qué |
|---|---|
| `Wallet` | Monedero. Pertenece a un `Customer` y a una `EventSession` (noche) o a un evento. Guarda `balance` (caché), `currency`, `status`. |
| `WalletEntry` | **Libro contable. Solo se agregan filas, nunca se editan.** Tipo, monto con signo, punto de cobro, personal, `idempotencyKey`, hora del dispositivo y hora del servidor. |
| `WalletCredential` | Lo que identifica al monedero en el punto de venta: `QR` (el de la entrada) o `NFC` (UID de la manilla). Estado `ACTIVE / BLOCKED / LOST`. |
| `CashlessPoint` | Punto de cobro: barra 1, comida, merchandising, guardarropa. Tiene catálogo opcional y personal asignado. |
| `CashlessProduct` (opcional) | Producto con precio, para cobrar por selección y no por monto libre. |
| `Topup` | Recarga: método de pago, quién la hizo, `Payment` asociado si fue online. |

Tipos de `WalletEntry`:

| Tipo | Efecto |
|---|---|
| `TOPUP` | Suma |
| `PURCHASE` | Resta |
| `REFUND_PURCHASE` | Suma (se anuló un cobro) |
| `CASHOUT` | Resta (se devuelve el dinero al cliente) |
| `ADJUSTMENT` | Corrección manual, con motivo obligatorio |
| `TRANSFER_OUT` / `TRANSFER_IN` | Cambio de credencial o de monedero |
| `INCLUDED_CREDIT` | Saldo regalado por el tipo de entrada (hoy el «consumo incluido» de una mesa) |
| `EXPIRY` | Saldo que caduca al cerrar la noche |

Regla de oro: `Wallet.balance` es una **caché** del libro, igual que en Colpa Caranda. Un trabajo de conciliación recalcula
desde el libro y avisa si no coinciden.

### Relación con lo que ya existe
- Una mesa o entrada con **consumo incluido** pasa a crear un `WalletEntry INCLUDED_CREDIT` en lugar de un `ConsumptionCredit`.
- El **consumo extra** que hoy se compra con la entrada es, en la práctica, una recarga hecha al comprar: se convierte en `TOPUP`.
- Mientras se migra, ambos conviven: el vale sigue funcionando en los eventos que no activen cashless.

---

## 6. Flujos

### 6.1 Recargar
1. **Online, antes del evento**: en «Mis entradas» aparece «Cargar saldo». Reutiliza `Order` y `Payment` (mismo webhook, misma idempotencia).
2. **En el recinto**: puntos de recarga atendidos por personal (efectivo, QR bancario o tarjeta). Es una venta de boletería con otro tipo de producto.
3. **Autorrecarga con el celular** en una fila de «solo recarga» (sin cola de cajero).

### 6.2 Cobrar
1. El cajero abre su punto de cobro en la app y arma el pedido (productos o monto libre).
2. Lee el QR dinámico del cliente (o toca la manilla).
3. El sistema descuenta de forma **atómica**: `UPDATE ... WHERE balance - monto >= 0`. Si no alcanza, rechaza y muestra el faltante.
4. Pantalla de resultado verde/roja con saldo restante; **idempotente** por `idempotencyKey` (un reintento no cobra dos veces).

### 6.3 Anular un cobro
Solo con permiso (supervisor). Genera `REFUND_PURCHASE`, nunca borra la fila original.

### 6.4 Cierre de la noche
Decisión de negocio (ver 10). Opciones, de menos a más complejas:
1. **Caduca** al cerrar (lo más simple; requiere aviso claro y revisión legal).
2. **Queda vigente** para otro evento de la misma organización.
3. **Devolución**: el cliente la pide desde la web (`CASHOUT`) y se paga por transferencia/QR.

### 6.5 Pérdida de credencial
Con QR: se cierra sesión en el otro teléfono y se reemite. Con manilla: se bloquea y su saldo pasa a otra con `TRANSFER_OUT/IN`.

---

## 7. Sin internet (punto crítico)

En un recinto lleno la señal falla justo cuando más se vende. Se reutiliza el enfoque de la app de puerta, con una diferencia:
**cobrar es dinero, no un conteo**, así que hay que acotar el riesgo.

- La app del punto de cobro descarga el **estado de saldos** de la noche antes de abrir (solo lo necesario).
- Sin conexión, valida contra el saldo cacheado y registra el cobro localmente, firmado por el dispositivo.
- **Tope por cobro y por credencial en modo offline** (equivalente al sobregiro de Bs 20 de Colpa Caranda, pero hacia abajo): por
  ejemplo, no aprobar más de X mientras no haya sincronizado. Evita que un mismo QR gaste su saldo en cinco barras a la vez.
- Al volver la conexión se sube en orden por hora del dispositivo. Si un saldo quedó insuficiente por dobles gastos, se registra
  como **deuda del evento** (la absorbe el organizador o iPass según el contrato) y la credencial queda marcada.
- Para reducir el doble gasto sin internet, el QR dinámico puede llevar un **contador de gasto** firmado, de modo que cada
  terminal rechace un QR que ya gastó por encima de lo permitido. Es una mejora de segunda fase.

---

## 8. Roles, pantallas y app

### Roles
- Nuevo rol `CASHLESS` (cajero de punto de cobro) o reutilizar `BAR` ampliado. Ve solo sus puntos y noches asignadas.
- `ADMIN/OWNER`: configuran puntos, catálogo, recargas, devoluciones y reportes.
- `CLIENT` (organizador): ve ventas y saldos pendientes de **sus** eventos, no datos de otros.

### Panel web (admin)
- Evento → pestaña «Cashless»: activar, definir puntos de cobro, catálogo, límites, regla de cierre.
- Monitor en vivo: recargas, ventas por punto y por hora, saldo total en circulación.
- Búsqueda de un cliente: su monedero y su historial (parecida a la ficha de entrada).
- Reportes: caja (recargas − ventas − devoluciones = saldo pendiente), ventas por producto, por punto y por cajero, saldo sin usar, conflictos de sincronización.

### Comprador (web)
- «Mi saldo» dentro de la entrada (`/entrada/[código]`), con historial de consumos y botón de recarga.
- El mismo QR dinámico de la entrada **sirve para pagar**: no hay que llevar otro código.

### App del punto de cobro
- Modo nuevo en `puerta_app` (como ya existe el modo Barra): selección de punto, catálogo táctil, lectura de QR/NFC, resultado.
- Lectura NFC con el `NfcAdapter` nativo de Android; sin NFC, QR con cámara.

---

## 9. Seguridad, legal y contabilidad

**Seguridad**
- Todo movimiento con `idempotencyKey`; el libro es de solo agregar; nada se borra.
- Límite de intentos y de monto por minuto; auditoría de cada ajuste y cada anulación.
- Manilla definitiva: chip con autenticación criptográfica (NTAG 424 DNA o equivalente) para evitar clonación; las MIFARE básicas se clonan.
- Clave de firma de cobros offline por dispositivo, revocable.

**Puntos a validar con un abogado o contador antes de vender (no es asesoría legal)**
- Si **guardar saldo de clientes** se considera dinero electrónico o instrumento de valor almacenado en Bolivia y qué autorización requiere
  (BCB/ASFI), o si basta con operar como un **vale de consumo** del organizador y no como billetera.
- Quién es el titular de los fondos recaudados (la cuenta del organizador, una cuenta de iPass, un fideicomiso).
- **Facturación (SIN)**: una recarga ¿se factura al cargar o al consumir? Lo habitual es facturar al consumir; hay que definirlo.
- Política de **saldo sin usar**: devolución obligatoria o caducidad permitida, y cómo se comunica al comprador.
- Comisión de la pasarela sobre las recargas y quién la asume.

Esto determina el diseño de la sección 6.4, así que conviene resolverlo **antes** de programar el cierre.

---

## 10. Decisiones que necesita tomar el negocio

1. ¿Qué pasa con el saldo sobrante: caduca, se devuelve o sirve para otro evento?
2. ¿Quién cobra al cliente: cada organizador en su cuenta o iPass centralizado y luego liquida?
3. ¿Habrá catálogo de productos o monto libre en el punto de cobro?
4. ¿Se recarga en el recinto? ¿Con qué medios (efectivo, QR, tarjeta)?
5. ¿Manilla desde el inicio o QR primero? (recomendado: QR primero)
6. ¿Quién absorbe el faltante por doble gasto sin internet?
7. ¿El cashless es por evento (el organizador lo activa) o por organización?
8. ¿Cuánto se cobra por el servicio: comisión por recarga, por venta o tarifa fija?

---

## 11. Fases sugeridas

| Fase | Contenido | Tiempo orientativo |
|---|---|---|
| 0. Definición | Responder la sección 10 y la validación legal de la 9 | 1–2 semanas (en paralelo) |
| 1. Monedero y libro | `Wallet`, `WalletEntry`, operaciones atómicas e idempotentes en `packages/db`, pruebas de concurrencia | 2–3 semanas |
| 2. Recarga online + saldo del comprador | Recarga con la pasarela, «Mi saldo» en la entrada, conciliación | 2 semanas |
| 3. Punto de cobro con QR | Modo en `puerta_app`, catálogo, resultado, panel de puntos | 3–4 semanas |
| 4. Sin internet | Descarga de saldos, cola firmada, topes, conflictos y deuda | 2–3 semanas |
| 5. Reportes y cierre | Caja, ventas por punto, regla de saldo sobrante, devoluciones | 2 semanas |
| 6. Manilla NFC | `WalletCredential NFC`, emisión y bloqueo, lectura nativa, pruebas con chip real | 3–4 semanas + compra de hardware |
| 7. Piloto | Un evento real pequeño, con soporte en sitio | 1 evento |

Son estimaciones para una sola persona dedicada; dependen de que el punto 0 se resuelva a tiempo.

---

## 12. Riesgos principales

| Riesgo | Mitigación |
|---|---|
| Cobro doble o saldo negativo por concurrencia | `UPDATE` atómico, idempotencia, prueba de carga (60+ cobros simultáneos sobre la misma credencial) |
| Doble gasto sin internet | Topes offline, contador firmado, asumir deuda definida por contrato |
| Fila larga en la barra | Selección de productos rápida, recarga previa online, varios terminales |
| Problema legal por guardar saldo | Validar antes; empezar como vale de consumo del organizador si hace falta |
| Clonación de manillas | Solo chips con autenticación; QR dinámico ya es resistente a capturas |
| Diferencias entre saldo y libro | Conciliación programada y alerta |
| Falla de red de la pasarela | Recarga solo se acredita con el webhook confirmado (como hoy) |

---

## 13. Qué se aprovecha de Colpa Caranda sin reinventar

- Libro de solo agregar + saldo como caché.
- Descuento atómico en SQL con condición de saldo.
- Tipos de transacción (recarga, consumo, reembolso, ajuste, transferencia).
- Reporte de control de caja y de manillas sin actividad.
- Cambio de manilla por pérdida con transferencia de saldo.
- Lo que **no** se copia: el folio maestro por grupo (aquí el equivalente sería un monedero de **mesa**, a evaluar), el «todo incluido» y el
  checkout con devolución en recepción.

---

## 14. Siguiente paso recomendado

1. Reunión corta con el cliente para cerrar la sección 10 (sobre todo 1, 2 y 5).
2. Consulta legal/contable de la sección 9.
3. Con eso, construir las fases 1 y 2 (monedero + recarga online) detrás de un interruptor por evento, sin tocar el flujo actual de entradas.
