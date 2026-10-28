# Promotores (RRPP)

Un promotor vende con **cobro por QR** los eventos que iPass le asigna y ve su **comisión en vivo**. Nunca recibe
efectivo: el cliente paga desde la app de su banco y, apenas se aprueba el pago, se emiten las entradas.

## Cómo se arma

1. **Alta en un solo paso**: Panel → *Promotores* → «+ Nuevo promotor» (también desde *Promociones*). Se cargan:
   - nombre, correo, teléfono y contraseña temporal;
   - su código (o se arma uno con su nombre, ej. `RP-JUAN-K7Q3M`), sin descuento;
   - el evento con sus funciones (todas o algunas), la comisión, el cupo y la vigencia.

   Para un organizador, entrar primero en él (Organizadores → Entrar). También se puede crear la cuenta en *Usuarios*
   (rol Promotor) y asignarle los eventos después.
2. **Más eventos o cambios**: en su ficha (*Promotores* → *Ver, asignar y liquidar*). Por evento:
   - **Comisión**: un **% de cada venta** (sobre lo que pagó el cliente, con descuentos ya restados) o **Bs por
     entrada** (un monto fijo por cada entrada o mesa vendida).
   - **Cupo** (opcional): cuántas entradas puede vender él ahí; lo que está esperando pago también cuenta.
   - **Funciones**: todas o algunas, con vigencia (desde y hasta) opcional.
3. El promotor entra al panel y solo ve **Vender y mi comisión**, con lo de hoy, lo de cada evento y lo que le falta
   cobrar.
4. **Liquidar**: cuando iPass le paga, en su ficha «Liquidar» marca esas ventas como pagadas y guarda el monto y una nota.
   Lo que venda después queda para la próxima liquidación.

## La venta

1. Elige la función, las entradas (también butacas y mesas en el mapa) y carga al cliente: nombre, carnet, correo y
   WhatsApp (opcional).
2. **Cobrar con QR**: las entradas quedan reservadas 10 minutos y se muestra el QR de pago.
3. Cuando el pago se aprueba: se emiten las entradas, llegan al correo del cliente, la comisión sube y aparece el botón
   **Mandar por WhatsApp** (abre el WhatsApp del promotor con el enlace de las entradas).

Lo que se compra en la web con el **enlace del promotor** (`/eventos/<evento>?promo=<código>`) o con su código también
suma a su comisión. El enlace recuerda el código 7 días y lo aplica solo al comprar.

La comisión de cada venta se calcula al crearla con la regla del evento y cuenta recién cuando el pago queda aprobado.
Si después se cambia la regla, lo ya vendido no cambia. iPass ve todo en *Promotores* (ventas, cobrado y comisión de
cada uno).

## Pago QR: hoy simulado

Todavía **no hay banco conectado**: el QR que se muestra es de prueba y no cobra nada.

- En la computadora de desarrollo aparece el botón **Simular que el cliente pagó**.
- En un servidor (producción) ese botón **no aparece**, salvo que se active a propósito con la variable
  `PAGO_SIMULADO=si` en el panel (Coolify). Sirve para probar el flujo completo; **quitarla antes de vender en serio**.

Para conectar el banco o la pasarela (ver también `docs/pasarela-de-pago.md`):

1. `PAYMENT_PROVIDER=<nombre>` y sus credenciales en el panel y en la web.
2. En `apps/admin/src/lib/actions/promoters.ts` (`promoterSellAction`), después de `sellAsPromoter`, pedir el cobro QR
   a la API del proveedor y guardar su id; la pantalla `promotor/cobro/[code]` muestra ese QR en lugar del de prueba.
3. El webhook del proveedor llama a `applyPaymentUpdate` (como cualquier pago real) y después a
   `sendOrderTicketsEmail`. La pantalla del promotor se actualiza sola cada 3 segundos.

## Cuenta de prueba (solo desarrollo)

`promotor@impacta.test` (ver el README): vende *Loko Fest* con 10% de comisión. La crea `npm run db:demo`.
