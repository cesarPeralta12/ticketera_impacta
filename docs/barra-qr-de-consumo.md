# Barra: QR de consumo (vale de un solo uso)

Cada mesa (o entrada con trago) de un boliche emite **un QR de consumo** aparte del QR de entrada. En la barra se lee **una sola vez**:
muestra de quién es, la mesa y cuánto consumo tiene, y queda **marcado como leído**. La segunda lectura dice «YA FUE LEÍDO»
(a qué hora y por quién). El de barra anota el detalle (nota opcional). No hay saldo en partes.

## Dónde lo ve el comprador
- Web `/orden/<código>` y «Mis entradas»: tarjeta «QR de consumo» (monto, QR, código y si ya fue leído).
- Correo de las entradas: una imagen de QR de consumo por mesa.
- Ticket de boletería: un ticket aparte «QR DE CONSUMO».

## Quién lo lee
- **Rol «Barra»** (Usuarios → Nueva cuenta → «Barra (lee QR de consumo)»): solo ve y lee las **noches que se le asignan**
  («Noches que atiende» en su fila). No vende ni ve reportes ni puertas. Entra al panel (`/barra`) o a la app.
- También pueden: dueño, administrador y cajero (en el panel; el cajero solo las noches que tiene asignadas).

## App de puerta (modo Barra)
- La cuenta de Barra entra directo al modo Barra; un administrador lo abre con «Barra: QR de consumo».
- Descarga los QR de la noche, lee con la cámara (o escribiendo el código), ve el consumo y toca «Marcar como leído».
- **Funciona sin internet**: marca en el teléfono y sube al volver la conexión. Si otro teléfono ya lo había leído,
  gana el que llegó primero al servidor y el otro recibe «ya leído» con quién y cuándo (se cuenta como conflicto).

## API móvil
- `GET /api/v1/bar/nights` · `GET /api/v1/bar/nights/<sesión>` (descarga) · `POST /api/v1/bar/nights/<sesión>/reads`.
- La cuenta de Barra no recibe funciones ni datos de puerta (`/assignments`, `/scans` y la descarga de puerta le responden vacío o 403).

## Migración
`20261031120000_vale_de_consumo_y_rol_barra`: rol `BAR`, código y fecha de lectura del vale. Los saldos que ya existían reciben un código
(los ya consumidos por completo quedan como leídos). Desplegar primero la web.
