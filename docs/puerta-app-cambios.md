# App de puerta: qué cambió en el servidor (octubre 2026)

Para quien mantiene la app Flutter de puerta. **Nada se rompe**: la app actual sigue funcionando igual que antes
(ingresos, puertas por sección, QR dinámico, sin conexión). Todos los cambios de la API son **campos nuevos** que la
app actual ignora.

Lo que la app actual **no puede hacer** hasta actualizarse (porque decide en el teléfono y rechaza una entrada ya usada
antes de consultar al servidor):

- **Puertas de salida** (y de "entrada y salida"): registrar que la persona salió.
- **Reingreso**: volver a entrar con una entrada que lo permite (por tipo de entrada: 1 ingreso, N o sin límite).
- **Zonas** (VIP, Súper VIP): rechazar en la puerta del VIP a quien no tiene VIP, y registrar el paso de General a VIP.

Mientras la app no se actualice, conviene **no configurar puertas de salida ni zonas** en los recintos (todo queda como
hasta ahora: un ingreso por entrada).

## 1. Descarga (`GET /api/v1/sessions/{id}/download`)

**Puertas** (`gates[]`), campos nuevos:

| Campo | Valores | Para qué |
|---|---|---|
| `direction` | `IN`, `OUT`, `BOTH` | `IN` = entrada (lo de siempre); `OUT` = salida; `BOTH` = entra o sale según si la entrada está adentro |
| `zoneId` | id o `null` | Zona a la que da la puerta (ej. la del VIP). `null` = ingreso general |

**Entradas** (`tickets[]`, solo las de la puerta del teléfono, `mine: true`), campos nuevos:

| Campo | Para qué |
|---|---|
| `inside` | `true` si la persona está adentro ahora |
| `entries` | Cuántas veces entró |
| `maxEntries` | Cuántas veces puede entrar (`1` = sin reingreso, `0` = sin límite) |
| `zoneIds` | Zonas que abre su tipo de entrada (vacío = las de siempre, sin restricción de zona) |

Cambio de comportamiento (ya activo, a favor de la app actual): una entrada que **salió y todavía puede reingresar**
baja con `status: "V"`, así la app la deja pasar también sin conexión. La sincronización incremental (`since`) ahora
también trae las entradas que salieron, reingresaron o cambiaron de zona.

## 2. Subida de lecturas (`POST /api/v1/scans`)

Cada resultado de la respuesta puede traer dos campos nuevos:

| Campo | Valores |
|---|---|
| `movement` | `ENTRY` (primer ingreso), `REENTRY`, `EXIT`, `ZONE_CHANGE` |
| `zone` | Nombre de la zona en la que quedó (o `null`) |

Valores nuevos de `result` (además de los de siempre):

| `result` | Título sugerido | Cuándo |
|---|---|---|
| `NOT_ACTIVATED` | IMPRESA SIN VENDER | Entrada impresa de un lote "activadas al vender" que todavía no se marcó vendida (posible fotocopia o robada). La descarga ya la trae con `status: "C"` |
| `NOT_INSIDE` | NO ESTABA ADENTRO | Se leyó en una puerta de salida pero la persona no figuraba adentro |
| `OUT_OF_HOURS` | FUERA DE HORARIO | Ya existía: pasó el último ingreso de la función o el horario de su entrada |

`offlineResult` (rechazos decididos sin conexión) ahora también acepta `OUT_OF_HOURS`, `NOT_ACTIVATED` y `NOT_INSIDE`.

## 3. Qué cambiar en la app

1. `ScanVerdict`: agregar `outOfHours('OUT_OF_HOURS')`, `notActivated('NOT_ACTIVATED')` y `notInside('NOT_INSIDE')`.
2. `Gate.fromJson`: leer `direction` y `zoneId`. `TicketRow.fromJson`: leer `inside`, `entries`, `maxEntries` y `zoneIds`.
3. Decisión en el teléfono (validator), con la puerta del teléfono:
   - **Salida** (`OUT`, o `BOTH` con `inside: true`): si la entrada está usada y `inside` → aceptar como salida
     ("SALIDA REGISTRADA") y marcarla afuera en la lista local. Si no estaba adentro → `NOT_INSIDE`.
   - **Entrada** (`IN`, o `BOTH` con `inside: false`):
     - Zona: si la puerta tiene `zoneId` y la entrada tiene `zoneIds` que no lo incluyen → `WRONG_GATE`.
     - `status: "V"` → ingreso (como hoy).
     - Usada, `inside: false` y `maxEntries == 0 || entries < maxEntries` → reingreso (sumar `entries`, marcar adentro).
     - Usada e `inside: true`: si la puerta da a otra zona permitida → cambio de zona; si no → `ALREADY_USED`.
4. Las salidas, reingresos y cambios de zona se suben como **aceptadas** (sin `offlineResult`): el servidor decide
   según la dirección de la puerta y lo deja registrado. Al recibir la respuesta, mostrar `movement` si viene
   ("Salida", "Reingreso", "Pasó a VIP").

El servidor sigue siendo la autoridad: procesa las lecturas en orden de hora, evita dobles ingresos y lista en el panel
("Ingreso en vivo") las lecturas sin conexión que chocaron.
