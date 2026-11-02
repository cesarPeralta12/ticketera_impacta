# Entradas con el código de otro proveedor

Cargar entradas que **ya existen** fuera de iPass (vendidas por un tercero, con su propio QR o código impreso) y que la
puerta las acepte con **ese** código. Plan original: «Plan: cargar entradas ya vendidas desde Excel» (1/11/2026).

## Qué está hecho (servidor y panel)

- **Asistente en el panel**: Evento → Importar → «O: entradas que ya tienen su código». Se sube el Excel o CSV como
  venga y en una ventana se elige la hoja, la fila de títulos, qué columna es cada dato (código, nombre, carnet, correo,
  butaca, monto), el tipo de entrada y la función (una columna emparejando cada valor, o uno para todas) y cómo se lee
  el código. Después, la revisión por fila y la confirmación de siempre (todo o nada, y se puede deshacer).
- **Datos**: cada entrada importada guarda `externalCode` (como vino) y `externalKey` (limpia, única por función). El
  lote guarda `sourceName` (origen), `codeRule` y `mapping`. Migración `20261103120000_codigos_externos`.
- **Reglas al importar**: un código no se repite en el archivo, ni en la función (de otro lote) ni es igual al código
  propio de una entrada de iPass. Una fila sin código recibe uno de iPass. Una mesa de varias personas no se carga con
  un solo código. El tipo tiene que admitir cómo se lee (QR o código de barras). A quien ya tiene la entrada del
  tercero no se le envía otra por correo.
- **Lectura en el servidor** (`scanTicket`): si lo leído no es una entrada de iPass, se limpia con las reglas de los
  lotes del evento y se busca por `externalKey` (primero en la función, después en el resto del evento para decir
  «función equivocada»). Pasa por las mismas reglas de siempre: una lectura, reingreso, puertas, zonas, método.
- **Panel**: la ficha de la entrada muestra el código del proveedor y su origen; el buscador encuentra una entrada por
  ese código; la revisión del lote muestra la columna del código.

## Lo que falta: app de puerta 1.8.0

La app actual descarta en el teléfono cualquier lectura que no tenga el formato de iPass (`extractTicketCode` en
`validator.dart` devuelve null), así que **todavía no lee estas entradas**. Lo que necesita:

1. **Descarga** (`GET /api/v1/sessions/:id/download`), campos nuevos y opcionales (una app vieja los ignora):
   - cada entrada importada trae `externalKey` (también en las compactas, para «puerta equivocada») y, en las de la
     puerta, `externalCode` para mostrarlo;
   - `session.codeRules`: las reglas de limpieza de los lotes del evento, y `session.requiresApp: "1.8.0"` cuando la
     función tiene entradas externas.
2. **Validador**: cuando `extractTicketCode` da null (o el código de iPass no está en la lista), limpiar lo leído con
   cada regla de `codeRules` y buscar por `externalKey` en la lista local. Después, las mismas reglas de siempre.
3. **Regla de limpieza** (copia exacta de `normalizeExternalCode` en `packages/core/src/external-codes.ts`):
   1. quitar espacios de los extremos; si es más largo que 200, no es un código;
   2. `fromUrl`: si empieza con `http(s)://`, usar el parámetro `code`, `codigo`, `ticket`, `c`, `t` o `id` (el primero
      que tenga valor) o, si no hay, lo que sigue a la última barra;
   3. a mayúsculas y los espacios repetidos en uno;
   4. `ignoreSeparators`: quitar espacios y guiones;
   5. quitar `prefix` y `suffix` (limpiados igual que el código) si están y queda algo;
   6. `ignoreLeadingZeros`: quitar los ceros del principio (dejando al menos un carácter);
   7. si queda vacío o pasa de 100 caracteres, no es un código.
4. **Pruebas compartidas**: `packages/core/src/external-codes.cases.json` tiene los casos (texto leído, regla y clave
   esperada). La prueba de TypeScript ya los usa; `validator_test.dart` debería leer el mismo archivo para garantizar
   que el teléfono y el servidor limpian igual.
5. **Sincronización**: hoy solo vuelve a descargar si lo leído «parece» de iPass. Con códigos externos, volver a
   descargar ante cualquier lectura desconocida, con un freno (una descarga cada 20 segundos como máximo).
6. **Ingreso manual**: aceptar cualquier código (no solo los de 10 caracteres de iPass).
7. **Pantalla del resultado**: mostrar «Código del proveedor: …» junto al nombre y el tipo.

## Decisiones tomadas (las recomendadas en el plan)

- La entrada importada no aparece en «Mis entradas» de la persona (ya tiene la del tercero).
- `00123` y `123` son códigos distintos (se puede cambiar por lote).
- Cada código entra una vez, más el reingreso que permita su tipo.
- La puerta sale del tipo de entrada (su sección y sus zonas), no se elige por fila.

## Pendiente para después

- Guardar el emparejamiento como «formato» para repetirlo con el mismo proveedor.
- Crear un tipo de entrada nuevo desde el asistente (hoy se crea en Precios y se vuelve).
- Confirmar «pasando el cupo» con una confirmación explícita (hoy esas filas quedan con error).
- Reporte de «Importadas» separado por origen.
