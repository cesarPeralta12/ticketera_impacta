# Promotores, cajeros y reportes: qué quedó hecho

Respuesta al documento del cliente "Promotores con cuenta de venta, cajeros por evento y reportes detallados". Cada
punto, cómo se usa en el panel y qué queda pendiente. Lo del promotor en detalle: [promotores.md](promotores.md).

## 1. Promotor con cuenta de venta ✅

- **Rol propio "Promotor"**: solo ve «Vender y mi comisión». No entra a barra, arqueo ni otros reportes.
- **Alta en un solo paso**: Panel → *Promotores* → «+ Nuevo promotor» (también desde *Promociones*). Se cargan su
  nombre, correo, teléfono, contraseña temporal, código (o se arma uno con su nombre), y el evento con sus funciones,
  comisión, cupo y vigencia. Todo se valida antes: si algo está mal, no queda una cuenta a medias.
- **Atribución automática**: cada venta guarda quién la vendió y con qué código. También cuentan las ventas web hechas
  con su enlace o código.
- **Código sin descuento**: solo para atribuir. Un código con descuento también se le puede dar.
- **Comisión** sobre lo cobrado (con descuentos ya restados), un % o un monto por entrada, por evento.
- **Cupo opcional** por evento: no puede vender más de esa cantidad (lo que está esperando pago también cuenta).
- **Funciones y vigencia**: se le asigna el evento completo o algunas funciones, con fecha desde y hasta opcional.
- **Su pantalla**: lo de hoy, lo del evento, su comisión (y cuánto le falta cobrar), su código y su enlace, y sus ventas.
- **Si deja de colaborar**: desactivar la cuenta (Usuarios) le corta el acceso. Sus ventas y su reporte se conservan.

## 2. Eventos y funciones por cajero ✅

- Cada cajero tiene un **alcance**: «Todo lo que está a la venta» (como siempre) o «Solo lo asignado».
- **Los cajeros que ya existían siguen en «Todo»**, para no romper la operación. Los nuevos nacen en «Solo lo asignado».
- **Dónde se configura**:
  - En la ficha del cajero (*Usuarios* → «Qué puede vender»): alcance, medios de cobro, eventos completos o funciones
    sueltas, vigencia, pausar o quitar.
  - En cada función (*Más opciones* → «Quién puede vender»): quién vende todo, quién la tiene asignada, y sumar un cajero.
- **Control del servidor**: la boletería, las mesas y la barra rechazan una función no asignada aunque alguien fuerce la
  dirección. La boletería solo le muestra sus funciones; si no tiene ninguna, le dice que pida acceso.

## 3. Cobro solo por QR de pasarela 🟡 (falta conectar la pasarela)

- ✅ El promotor **no tiene efectivo ni tarjeta**: genera un cobro QR, las entradas se reservan y se emiten solo
  cuando el pago queda aprobado. Si vence, la reserva se libera.
- ✅ **Medios de cobro por cuenta** para los cajeros comunes: efectivo, QR y tarjeta, cada uno se puede quitar.
- ✅ **Anulaciones y devoluciones** solo por un administrador de iPass, con motivo obligatorio. Quedan en el registro de
  seguridad (Seguridad) y en la ficha de la venta. No se anula lo que ya se usó en la puerta.
- ✅ **Conciliación de cobros** (*Conciliación de cobros* en el menú de iPass):
  - lo cobrado por día y medio;
  - lo que hay que revisar: pagos sin entradas, cobros dobles, ventas sin pago, cobros QR abandonados y devoluciones;
  - la comparación contra el reporte de la pasarela (pegar "referencia;monto").
- ❌ **Falta la pasarela real.** Hoy el QR es de prueba (no cobra). Es una decisión comercial de iPass: qué banco o
  pasarela y cuándo llegan las credenciales. Ver [pasarela-de-pago.md](pasarela-de-pago.md) y [promotores.md](promotores.md).
  **Mientras tanto, no vender con promotores en producción** (solo probar con `PAGO_SIMULADO=si`).

## 4. Reporte detallado de ventas ✅

*Ventas* muestra una fila por venta:

- **Columnas**: fecha, orden, vendedor (cajero, promotor o «Web», con su rol), canal y medio de cobro, comprador (nombre,
  carnet y correo), qué compró (evento, función, tipos), total con descuento y código, y estado.
- **Filtros**: búsqueda, organizador, evento, función, vendedor, canal, medio, estado y rango de fechas.
- **Resúmenes arriba**: total vendido, por vendedor y por medio de cobro.
- **Exportación** a **Excel** (hoja con el detalle y hoja con los resúmenes) y **CSV**, con las mismas columnas más el
  subtotal, la referencia del pago, el promotor y la comisión.
- **Ficha de cada venta**: pagos con su referencia, entradas, comisión (liquidada o por pagar), y anular o devolver.
- **Reporte del promotor**: él ve lo suyo (hoy, por evento, comisión). iPass ve todos en *Promotores*: ventas, cobrado,
  comisión y lo **por pagar**.
- **Liquidación**: en la ficha del promotor, «Liquidar» marca sus ventas pagadas como pagadas y guarda cuánto se le pagó
  (con una nota). Lo que venda después queda para la próxima.
- **Permisos**: el cajero ve solo su día; el promotor solo lo suyo; el organizador solo sus eventos; iPass todo.

## 5. Zonas por tipo de entrada ✅

- Ya funcionaba: zonas (General, VIP, Ultra VIP), puertas que dan a una zona y qué zonas abre cada tipo de entrada.
- **Probado con un boliche de tres zonas** (prueba automática):
  - una general no entra por la puerta VIP ni Ultra VIP;
  - una VIP no entra por la Ultra VIP;
  - una Ultra VIP pasa de General a Ultra VIP sin gastar otro ingreso.
- **Aforo que bloquea** (nuevo): en el recinto, cada zona tiene «Bloquear al llenarse». Apagado: el aforo solo informa.
  Prendido: con la zona llena, la puerta responde «Zona llena» hasta que salga alguien.
- **"Incluye: Zona VIP"** (nuevo): se ve al comprar, en la entrada (web), en el correo y en el ticket de boletería.
- **Nombre de la zona en la app de puerta** (nuevo): el servidor ya lo manda (`zoneName`, `zones`). Falta que la app de
  puerta lo muestre: ver [puerta-app-cambios.md](puerta-app-cambios.md) §5.
- **Lounges y mesas** se venden como un tipo de entrada más: se les marcan las zonas que abren igual que a cualquier
  entrada, en Precios → Ajustes → «Zonas que abre».
- **Invitaciones**: abren las zonas de su tipo de entrada.

## Decisiones que siguen abiertas (del cliente)

- Qué pasarela de pago y cuándo llegan las credenciales.
- Si un VIP puede entrar directo por la puerta VIP sin pasar por la general. Hoy sí puede.
- Quién liquida las comisiones y cada cuánto. El sistema ya lo registra; falta la regla.
