# Tarjetas NFC por número de serie (iPass Canje)

Esto reemplaza el borrador anterior, que grababa un JSON dentro de la tarjeta. Se cambió porque la tarjeta que se probó
(Mifare Ultralight, número de serie `04:7F:8C:52:0F:7A:80`) tiene unos 48 bytes de memoria y ese JSON no cabía.

## Idea

**No se escribe nada en la tarjeta.** El canje lee su número de serie (UID) y la huella de la etiqueta (tipo, modelo,
tecnologías), y los vincula a la entrada en el servidor. En la puerta se lee la tarjeta, se busca el número de serie en la
lista descargada y se valida la entrada que le corresponde, igual que con un QR. Funciona sin internet en la puerta.

Como no hay nada grabado, no hay nada que se pueda editar.

## Qué se construyó

| Parte | Qué hace |
|---|---|
| Servidor | Campos nuevos en cada entrada (`nfcUid`, `nfcCard`, `nfcLinkedAt`, `nfcLinkedById`) con clave única por función. Ruta `POST /api/v1/nfc-cards` para vincular. La descarga de la puerta ahora lleva el `nfcUid`, completa e incremental. Todo queda en el registro de auditoría. |
| Regla compartida | `packages/core/src/nfc-uid.ts`: cómo se normaliza el número de serie. Los mismos casos (`nfc-uid.cases.json`) los prueban el servidor, iPass Puerta e iPass Canje. |
| iPass Canje (`apps/canje_app`) | Lee la entrada (QR, barras o escrita), comprueba que sirve y que su tipo tiene NFC, lee la tarjeta y la vincula. También permite cambiar una tarjeta perdida y leer una tarjeta sin modificarla. |
| iPass Puerta | Al acercar una tarjeta, busca su número de serie en la lista local y valida la entrada. Si no está, intenta el formato anterior (pulsera con el código escrito). Base local versión 7. |

## Reglas del servidor al vincular

- Solo dueño y administradores (igual que grabar pulseras).
- La entrada tiene que ser de esa función, estar vigente (no anulada ni usada) y su tipo debe tener **NFC activado**. Si no, la
  puerta rechazaría la tarjeta.
- Una tarjeta pertenece a **una sola entrada por función**. Si ya es de otra, no se pisa.
- Una entrada con tarjeta no cambia sin confirmación. Con «cambiar la tarjeta» (perdida o dañada) la anterior queda libre y deja
  de abrir la puerta.
- Se rechaza el número de serie que no identifica: todo ceros o unos, largos raros, y los **aleatorios** (4 bytes que empiezan
  en `08`: los emiten teléfonos y tarjetas virtuales y cambian en cada lectura).

## Seguridad: lo que sí y lo que no

- El número de serie de una tarjeta de fábrica **no se puede cambiar con un teléfono**.
- Se puede **clonar** con tarjetas «mágicas», baratas. Las Ultralight no tienen cifrado que lo impida. Se reduce el riesgo con la
  regla de una entrada, un ingreso, y con el registro de cada paso (operador, puerta, hora).
- La huella (tipo, modelo, tecnologías, ATQA y SAK) se guarda para poder detectar que una tarjeta no es del modelo esperado. Hoy
  se guarda; **todavía no se compara en la puerta**.
- Para que sea realmente imposible de copiar hacen falta tarjetas con autenticación (NTAG 424 DNA) y un servidor que valide su
  firma. Es otro nivel de desarrollo.

## Pendiente y límites

1. **El canje necesita internet**: el servidor decide si la tarjeta ya es de otra entrada. En la puerta no hace falta.
2. **Dos puertas sin internet** que lean la misma tarjeta: la regla de un solo ingreso ya existe y avisa al sincronizar.
3. **Comparar el modelo en la puerta** (rechazar tarjetas con otro tipo o modelo que el vinculado).
4. **Ver y desvincular desde el panel**: hoy una tarjeta solo se cambia desde iPass Canje. No hay pantalla en el panel para ver
   qué tarjeta tiene cada entrada.
5. **Importación masiva**: cargar una lista de números de serie de un lote de tarjetas por Excel. No está hecho.
6. **iPhone**: lee el número de serie; el canje es más seguro desde Android.
7. **Probar con tarjetas reales** en los dos Ulefone y revisar que el modelo (`Mifare Ultralight`) sale bien en la huella.

## Cómo probar

1. Aplicar la migración `20261123120000_tarjetas_nfc` en la base de datos (ver `packages/db`, `db:deploy`).
2. Desplegar el panel con la ruta nueva y compilar las dos apps con `--dart-define=API_URL=<panel>`.
3. En el panel, activar NFC en el tipo de entrada.
4. En iPass Canje: descargar, canjear una entrada y acercar la tarjeta.
5. En iPass Puerta: descargar de nuevo la función y acercar la tarjeta.
