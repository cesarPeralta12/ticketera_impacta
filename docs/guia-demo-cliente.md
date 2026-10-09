# Guía de demostración al cliente

Recorrido completo del sistema, en el orden en que cuenta mejor la historia: **cómo compra la gente → cómo entra → cómo lo maneja el organizador → cómo lo controla Impacta**. Dura 35–45 minutos con todo; las partes marcadas *(opcional)* se pueden saltar si hay poco tiempo.

Todas las cuentas de demostración usan la contraseña `impacta123`.

## 0. Preparación (hazla el día anterior)

### En el servidor
- [ ] **Redesplegar** el sitio y el panel con la última rama (`feature/puerta-flutter`). Verifica `https://ticketera.proshop.lat/api/health` y `https://ticketera-panel.proshop.lat/api/health`.
- [ ] **Zonas en el mapa.** La base de demostración se cargó antes de que existieran las formas: entra como `admin@impacta.test` a **Recintos → Sonilum Arena / Arena 26 / Sonilum Plaza / Tahuichi** y, en "Zonas de entrada general", pulsa **Colocar en el mapa** en cada zona (Cancha, VIP, Campo, Palco, Pista, General…). Sin esto el comprador ve solo la lista.
- [ ] **Puertas.** Arena 26 ya tiene *Acceso norte → Campo* y *Acceso sur → Palco* (así se ve "Ingreso por: Acceso norte" en cada entrada). Si quieres mostrarlo en otro recinto, configúralo en **Recintos → Puertas de acceso**.
- [ ] **Un evento con QR dinámico.** Los eventos de la demo son de QR fijo y no se pueden convertir una vez vendidos. Crea uno nuevo para esta parte: en **Eventos → Nuevo evento** (por ejemplo "Concierto VIP"), agrega una función en Arena 26, y en "Tipos de entrada" crea un tipo con la casilla **QR dinámico**. Publícalo, y asigna la función a `puerta@impacta.test` (Acceso norte).
- [ ] **Compra de ensayo** del evento dinámico con `comprador@impacta.test`, abrir la entrada con internet una vez (así queda lista sin conexión) y ver que el celular de la puerta la lee.
- [ ] Revisa que `PAYMENT_PROVIDER=directo` (pase directo: **no cobra**).

### Los celulares
- [ ] **Celular de la puerta:** instala la APK (`app-release.apk`), inicia sesión con `puerta@impacta.test` y **descarga los datos de Loko Fest con wifi**. Deja la batería cargada y el brillo alto.
- [ ] **Celular del comprador:** abre `https://ticketera.proshop.lat` en Chrome, inicia sesión con `comprador@impacta.test`, abre **Mis entradas** y, si quieres, "Agregar a pantalla de inicio".
- [ ] Un **segundo celular o la laptop** para mostrar el panel mientras el comprador usa el suyo.

### Para tener a mano
- La laptop con tres pestañas: el sitio (como comprador), el panel de Impacta (`admin@impacta.test`) y el panel de un organizador (`organizador@cumbre.test`) en una ventana de incógnito.
- Un correo **real** tuyo para la parte de correo (las cuentas `@impacta.test` no existen y no reciben nada).
- Esta lista de cuentas:

| Rol | Cuenta | Para qué |
|---|---|---|
| Dueño de Impacta | `admin@impacta.test` | Todo |
| Organizador | `organizador@cumbre.test` | Su evento "Noche de Gala Cumbre" |
| Organizador | `organizador@andeslive.test` | Evento esperando aprobación |
| Cliente | `cliente@impacta.test` | Ve el ingreso en vivo de Loko Fest |
| Cajero | `caja@impacta.test` | Boletería |
| Portero | `puerta@impacta.test` | Loko Fest · Acceso norte (Campo) |
| Portero | `puerta.sur@impacta.test` | Loko Fest · Acceso sur (Palco) |
| Comprador | `comprador@impacta.test` | Compras (CI 1234567) |
| Comprador | `comprador2@`, `comprador3@impacta.test` | Más compradores |

Códigos promocionales: `IMPACTA10` (10 % en todo) y `LOKO20` (20 % solo Loko Fest, con promotor "Rodrigo (RRPP)").

## 1. Presentación (2 min)
Qué es el sistema: venta de entradas online + control de acceso en la puerta + panel para organizadores, todo en uno. Tres piezas: **el sitio** (compradores), **el panel** (organizadores e Impacta) y **la app de puerta** (porteros).

## 2. El comprador (10 min) — sitio web
1. **Portada.** Eventos publicados, categorías, buscador. Entra a *Noche Electrónica: Alok Bolivia*: se ve el **descuento de preventa** (precio normal tachado y el % hasta la fecha).
2. **Cuenta.** Para comprar hay que tener cuenta con **carnet** y **correo confirmado**. Si quieres mostrarlo: registra una cuenta con tu correo real, llega el correo de confirmación (necesita Resend activo).
3. **Sala de espera.** Entra a la compra de *Loko Fest* (tiene cola virtual): se ve la fila, tu lugar, y el turno limitado para comprar. Explica que protege el sistema cuando miles compran a la vez.
4. **Mapa con butacas.** *La Deliciosa Historia del Xocolate* o *Piazzolla Sinfónico*: elegir butacas numeradas en el mapa, precios por sección, butacas ocupadas.
5. **Mapa con zonas generales.** *Un Verano en el Illimani*: las zonas (Cancha, VIP) dibujadas en el mapa con "Quedan N · desde Bs X"; tocar una zona baja al selector de cantidad y se marca con "× 3".
6. **Código promocional.** En *Loko Fest* usa `LOKO20`: se ve el descuento y el total antes de pagar.
7. **Pago.** *Reservar y pagar*. Hoy es **pase directo** (la compra queda pagada sin cobrar): lo dejamos listo para conectar una pasarela real cuando el cliente la contrate. Dilo con claridad.
8. **Entradas.** La orden muestra cada entrada con su QR y **"Ingreso por: Acceso norte / sur"** según la sección. Llega también por correo.

## 3. Mis entradas (4 min)
- **Mis entradas:** QR, estado y puerta de ingreso.
- **Transferir** una entrada a otra persona (por correo o carnet): aceptar la oferta pasa la entrada a su cuenta y el QR anterior deja de valer. *(opcional)*
- **QR dinámico:** abre la entrada del evento dinámico: el QR **cambia cada 30 segundos** y funciona **sin internet**. Pon el celular en modo avión y recarga: sigue funcionando. Haz una captura de pantalla y muéstrala en la puerta unos minutos después: **"QR vencido"**.

## 4. La puerta (6 min) — app móvil
1. Inicia sesión con `puerta@impacta.test`: ve **solo sus funciones y su puerta** (Acceso norte). Las entradas se descargan al teléfono.
2. **Leer una entrada** del comprador (QR del celular): aparece el nombre, tipo y sección; el portero **acepta** y entra. La misma entrada otra vez: **"Ya utilizada"** con la hora.
3. **Entrada de otra puerta:** lee una entrada de Palco en el Acceso norte: **"Puerta equivocada, debe entrar por Acceso sur"**.
4. **Sin internet:** pon el celular de la puerta en modo avión y vuelve a leer. Todo sigue funcionando; al reconectar, **sincroniza solo**.
5. **Respaldo manual:** escribir el código a mano (o código + número de 6 dígitos si es QR dinámico).
6. Qué más puede leer: código de barras y NFC, según se configure por tipo de entrada. *(opcional)*

## 5. El organizador (8 min) — panel (`organizador@cumbre.test`)
1. **Resumen** con ventas e ingresos de **sus** eventos; no ve nada de otros organizadores.
2. **Eventos:** crear un evento, funciones (fecha y recinto), tipos de entrada con precio, cupo, **preventa** con descuento y **QR dinámico**. Se crea como borrador y **Impacta lo aprueba** antes de publicar.
3. **Recintos:** el editor del mapa: butacas (grilla o arco) y **zonas generales con forma** (rectángulo, óvalo, trapecio, arco). Puertas de acceso y qué secciones entran por cada una.
4. **Promociones:** crear un código con límite de usos, vigencia y un **promotor/RRPP** con comisión; ver sus ventas y la comisión que le toca.
5. **Ventas:** cada compra, comprador, canal y estado.
6. **Boletería:** vender en caja (efectivo, QR, tarjeta) e **imprimir el ticket** (térmico de 80 mm o A4) con su puerta.
7. **Invitados:** cargar una lista, emitir invitaciones y la hoja de QRs. *(opcional)*
8. **Límite de eventos:** explica que Impacta puede fijarle un máximo de eventos activos (se ve en el panel de Impacta, paso 7).

## 6. Ingreso en vivo (3 min)
- Como organizador o con `cliente@impacta.test`: **Ingresos en puerta** de Loko Fest, en vivo: cuántos entraron, por qué puerta, el **mapa de butacas y las zonas** con quién ya entró, y los **intentos rechazados** (ya usada, puerta equivocada, **QR vencido** = intentos de captura).
- Lee una entrada con el celular de la puerta y mira cómo se actualiza el panel.
- `cliente@impacta.test` ve solo su evento y mientras Impacta le habilite el acceso.

## 7. Impacta (8 min) — `admin@impacta.test`
1. **Resumen general** y **Organizadores:** alta de un organizador (razón social, responsable y contraseña temporal), ver sus eventos, **entrar a su panel** ("Entrar como"), suspenderlo, y **fijar su límite de eventos**.
2. **Aprobaciones:** aprobar o rechazar (con nota) el evento de Andes Live.
3. **Usuarios y porteros:** crear un portero **dentro del organizador** (Organizadores → Ver → Gestionar sus cuentas), asignarle una función y una puerta, ver sus teléfonos con sesión y **cerrar una sesión**.
4. **Seguridad:** quién entró, quién falló, desde qué IP y qué dispositivo (navegador o modelo de celular), alertas de dispositivos nuevos, bloqueos por intentos, entradas abiertas desde muchos aparatos. Filtros por cuenta, tipo, fechas e IP.
5. **Ventas** de toda la plataforma y reportes.

## 8. Cierre (2 min) — lo que ya está y lo que viene
**Ya está:** compra con cola, mapas con butacas y zonas, preventas y promociones con RRPP, transferencias, correo, puerta con app móvil que funciona sin internet, QR dinámico, organizadores aislados con aprobaciones y límites, seguridad y registro.
**Se conecta después (decisiones del cliente):** pasarela de pago real (hoy pase directo), facturación (SIN), recordatorio por correo del QR dinámico, app para iPhone, Cloudflare delante del servidor.

## Si algo falla (plan B)
| Problema | Qué hacer |
|---|---|
| El celular de la puerta no lee | Usa el ingreso manual del código; o muestra el panel de ingreso en vivo con otra entrada |
| El correo no llega | Muestra la orden en el sitio (tiene las mismas entradas) y di que depende del dominio verificado en Resend |
| La cola se tarda | Entra con una cuenta que ya esté admitida o muestra otro evento sin cola (Un Verano en el Illimani) |
| Sin internet en la sala | La puerta y el QR dinámico funcionan sin conexión (es parte de la demostración); el panel y el sitio no |
| Una cuenta queda bloqueada por intentos | Espera 15 minutos, o usa otra cuenta de la lista |
| Se acabaron las entradas de la demo | Crea otro comprador y compra más; el aforo es grande |

## Después de la demostración
- Las compras de prueba quedan en la base de demostración. Para dejarla limpia **en un servidor nuevo** se vuelve a cargar la semilla (nunca sobre una base con datos reales).
- Rota las contraseñas de demostración antes de mostrar el sistema a más gente, y cierra el puerto público de Postgres.
