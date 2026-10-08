# Pagos: pase directo hoy, pasarela real después

## Cómo está hoy
- **Pase directo** (`PAYMENT_PROVIDER="directo"`, o sin configurar): al confirmar la compra, el pago se aprueba en el
  acto y no se cobra nada. Las entradas se emiten, el QR se genera y llega el correo.
- Se eliminó la pasarela simulada (página de pago falso y webhook de prueba).
- El pase directo pasa por las mismas reglas que un pago real (`applyPaymentUpdate`): reserva vigente, monto y moneda
  coinciden, cupo disponible, idempotencia. Solo cambia *quién* aprueba: el sistema, no un banco.
- Cada pago queda registrado con `provider = "directo"` y `providerStatus = "pase_directo"`, así que los reportes
  distinguen lo que se cobró de lo que fue pase directo.
- En producción con pase directo, el servidor escribe una advertencia en el log: **cualquiera puede "comprar" sin pagar**.
  No publiques ventas reales con esta opción.

## Qué hay que hacer para conectar una pasarela real
Todo lo demás (órdenes, reservas, entradas, correos, reportes, reembolsos pendientes) ya funciona con cualquier proveedor.

1. **Elegir la pasarela** autorizada por el BCB que acepte QR interoperable y tarjetas (Mercado Pago no opera en Bolivia).
   Pedirles: API de creación de cobro, webhook firmado, consulta del estado de un cobro y reembolsos.
2. **Variables de entorno**: `PAYMENT_PROVIDER="<nombre>"` y las credenciales del proveedor (nunca en el repositorio).
3. **Iniciar el cobro** (`apps/web/src/lib/payments.ts`): al pagar una orden, `startPayment(orderCode, provider)` crea el
   intento; luego se llama a la API del proveedor y se devuelve la URL de su página de pago (`checkoutUrl`).
4. **Webhook** (`apps/web/src/app/api/webhooks/<nombre>/route.ts`), copiando este orden:
   1. Verificar la firma del proveedor (si no es válida, 401).
   2. `recordWebhookEvent({ provider, externalId, topic, payload })` → si `alreadyProcessed`, responder OK sin hacer nada.
   3. Consultar a la API del proveedor el estado real del cobro (no confiar en el cuerpo del webhook).
   4. `applyPaymentUpdate({ paymentId, provider, providerPaymentId, status, providerStatus, amount, currency })`.
   5. `markWebhookProcessed(event.id)` y, si el resultado es `PAID`, `notifyOrderPaid(orderCode)`.
5. **Retorno del navegador**: la página de la orden ya muestra "confirmando tu pago…" y se actualiza sola hasta que llega el
   webhook; el retorno desde la pasarela nunca confirma un pago.
6. **Conciliación diaria**: comparar los pagos aprobados del sistema contra el reporte del proveedor y marcar diferencias.
7. **Reembolsos**: un pago aprobado sobre una reserva vencida queda marcado `REFUND_REQUIRED`; falta la pantalla del
   panel para ejecutarlo contra la API del proveedor.
8. **Facturación electrónica (SIN)**: se genera a partir de la orden pagada (NIT/carnet del comprador, que ya es obligatorio).

## Referencia rápida (packages/db/src/operations/payments.ts)
| Función | Para qué |
|---|---|
| `startPayment(orderCode, provider)` | Abre un intento de pago de una orden pendiente y vigente |
| `applyPaymentUpdate(update)` | Único lugar donde un pago pasa a aprobado/rechazado; idempotente |
| `recordWebhookEvent` / `markWebhookProcessed` | Registro e idempotencia de webhooks |
