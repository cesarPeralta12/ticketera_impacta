# Importar entradas desde Excel: comportamiento esperado

Para cargar en el sistema entradas vendidas o regaladas por fuera (planillas de un organizador, cortesías, convenios).
Está en cada evento: **Importar Excel** (arriba, junto a Vista previa y Reporte). Las pruebas automáticas están en
`packages/db/test/importacion-excel.test.ts`.

## 1. Plantilla

"Descargar plantilla" baja un `.xlsx` hecho para ese evento:

- Hoja **Entradas**: una fila por persona (en una mesa, una fila por mesa). Función y Tipo de entrada tienen listas
  desplegables con lo que existe en el evento.
- Hoja **Ayuda**: las funciones, los tipos (con cómo se ubica cada uno, cuántas personas entran y su precio en la web)
  y qué va en cada columna.

| Columna | Qué va |
|---|---|
| Función | De la lista. Si el evento tiene una sola función, puede ir vacía. |
| Tipo de entrada | De la lista, tal como se llama en el evento (no importan mayúsculas ni tildes). |
| Nombre | Obligatorio (nombre y apellido). |
| Carnet | Opcional. No puede repetirse dentro del archivo. |
| Correo | Opcional. Si está, se le pueden mandar las entradas por correo. |
| Butaca o mesa | Solo en zonas numeradas (ej. F-12) o mesas (ej. Mesa 5). En entrada general, vacío. |
| Monto cobrado (Bs) | Opcional: lo que se cobró por fuera. Vacío = 0 (cortesía). |

También se acepta `.csv`. Máximo **5.000 filas** por archivo. Los títulos se reconocen aunque cambien un poco
(ej. "Tipo", "CI", "Email", "Asiento", "Precio").

## 2. Vista previa (no emite nada ni ocupa cupo)

Al subir el archivo se ve, fila por fila, si está lista o qué tiene mal:

| Caso | Mensaje (ejemplo) |
|---|---|
| Falta el nombre | Falta el nombre. |
| Falta el tipo | Falta el tipo de entrada. |
| Correo mal escrito | Correo inválido (fernando.huanca@correo). |
| Monto que no es un número | Monto inválido (ochenta): usa solo números, ej. 150 o 150,50. |
| Carnet repetido en el archivo | El carnet 6231478 LP está repetido (fila 3). |
| Tipo que no existe | El tipo de entrada "VIP" no existe en esa función. |
| Tipo de QR dinámico | "Palco" es de QR dinámico: vive en el celular del comprador y solo se vende online. |
| Función que no existe o cancelada | La función "…" no existe: elígela de la lista de la plantilla. / Esa función está cancelada. |
| Evento con varias funciones y la columna vacía | Falta la función (el evento tiene varias). |
| Zona numerada sin butaca | "Platea" es numerada: falta la butaca. |
| Butaca que no existe, repetida o ya vendida | La butaca "A-9" no existe en Platea. / A-1 está repetida (fila 2). / A-2 ya está vendida o reservada. |
| Mesa mal escrita, repetida o ya asignada | Mesa "x" no válida… / La mesa 3 de "Mesa VIP" está repetida (fila 2). / … ya está asignada. |
| Sin cupo para todas las filas de un tipo | Sin cupo en "General": ya no quedan lugares para esta fila. |
| Más de 5.000 filas | Máximo 5000 filas por archivo (este tiene …): divídelo en varios. |

Una fila puede juntar varios problemas en un mismo mensaje (ej. "Falta el nombre; correo inválido (…)").

**Avisos** (no impiden importar):

- Una butaca escrita en un tipo de entrada general: "General" es entrada general: no lleva butaca (se ignora "F-12").
- Un carnet que ya tiene entradas en el evento: El carnet … ya tiene entradas en este evento (orden …).

## 3. Confirmar: todo o nada

- **Si hay una sola fila con error, no se emite ninguna entrada.** El panel pide corregir el Excel y volver a subirlo
  ("Subir el archivo corregido"). Esto es a pedido de ProShop (22-10-2026).
- Sin errores, "Confirmar e importar N entrada(s)" vuelve a revisar el cupo y las butacas (pudo venderse algo desde la
  vista previa) y emite todas juntas. Si algo cambió, no emite nada y pide volver a subir el archivo.
- Cada fila queda como una orden pagada del canal **Importadas**: ocupa cupo igual que una venta web y suma lo
  declarado en "Monto cobrado" al reporte del evento.
- Tiempo: 5.000 filas se confirman en unos 6 segundos (medido en local el 22-10-2026).

## 4. Después de confirmar

- **Entregar las entradas**: PDF para imprimir (carta, A4, térmica o imprenta) y **Enviar por correo** a quienes tienen
  correo (de a 50 por clic; a los que no tienen, se les imprime).
- Las entradas entran por la puerta como cualquier otra (QR con firma).
- **Deshacer la importación**: anula las entradas que todavía no se usaron y libera su cupo. Las que ya entraron quedan
  registradas como usadas. Se puede deshacer una sola vez.
