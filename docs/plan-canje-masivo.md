# Plan: aviso de NFC, rol de canje y carga masiva de manillas

Fecha: 24/11/2026. Estado: **propuesta, sin implementar**. Parte de lo que ya está en `main` (vinculación por número de
serie, `docs/plan-app-nfc-tarjetas.md`).

## 0. Cómo funciona hoy el canje

**No crea entradas ni escribe en el chip.** La entrada ya existe (comprada, importada o impresa). Al canjear, el servidor
agrega a esa entrada:

| Dato | Para qué |
|---|---|
| Número de serie de la tarjeta (`nfcUid`) | La puerta reconoce la tarjeta por él |
| Huella (`nfcCard`: tipo, modelo, tecnologías) | Revisar que sea el modelo esperado |
| Cuándo y quién la vinculó (`nfcLinkedAt`, `nfcLinkedById`) | Auditoría y sincronización |
| Un registro en Seguridad | «Tarjeta vinculada» o «Tarjeta cambiada» |

- La entrada sigue siendo **una**: su QR sigue sirviendo. Entra con el QR o con la tarjeta; lo primero que se use cuenta.
- Una tarjeta es de una sola entrada **por función**. Cambiarla libera la anterior, que deja de abrir.
- Canjear necesita internet. La puerta funciona sin internet **después** de actualizar su lista.

## 1. Aviso «No supported application for this NFC tag»

**Por qué sale:** el chip no trae contenido y ninguna app declaró que lo atiende cuando está cerrada. Android muestra
ese aviso.

| Opción | Qué se logra | Límite |
|---|---|---|
| **A. La app de puerta atiende el chip** (recomendada) | En los teléfonos del equipo, acercar la tarjeta abre la app y muestra de quién es | Solo teléfonos con la app |
| **B. Lector activo mientras la app esté abierta** (recomendada) | No sale el aviso en ninguna pantalla de la app | Solo con la app abierta |
| C. Grabar un enlace en el chip | Cualquier teléfono (también el del asistente) abre una página de iPass | Hay que escribir en cada manilla; cambia la idea de «no escribir nada» |

- Hacer **A + B**. La C, solo si molesta que le salga al público.
- Al abrirse por una tarjeta, la app **solo consulta**: nunca marca un ingreso por un toque accidental.
- Solo una de las dos apps debe atender el chip; si no, Android pregunta cuál abrir cada vez.
- La opción C no afecta la identificación (sigue siendo el número de serie). En un Ultralight (48 bytes) entra un enlace
  corto.
- Trabajo: `AndroidManifest.xml` (`TECH_DISCOVERED`), un puente nativo pequeño en `MainActivity` y la pantalla de
  consulta.

## 2. Rol nuevo: «Canje» (carga las entradas)

| Puede | No puede |
|---|---|
| Entrar a iPass Canje | Marcar ingresos ni usar la app de puerta |
| Ver solo las funciones que le asignen | Vender, ver dinero o reportes |
| Descargar la lista de esas funciones (nombre y carnet) | Entrar a la configuración del panel |
| Vincular tarjetas y cargar lotes de manillas | Crear cuentas |
| Cambiar una tarjeta perdida (queda registrado) | Anular entradas |

Cambios:
- Base: valor `REDEEMER` en `StaffRole` (migración).
- Servidor: permitirlo en login de la app, funciones, descarga y `nfc-cards`; **rechazarlo en `scans`** (hoy cualquier
  cuenta que controla la función puede registrar ingresos).
- Panel: crear la cuenta en Usuarios y asignarle funciones (como «Noches que atiende» de Barra).
- Apps: iPass Puerta lo rechaza con un mensaje claro; iPass Canje avisa **al entrar** si la cuenta no puede vincular, no
  después de leer la entrada.

## 2 bis. Canje en la web para boleteros (hecho, 24/11/2026)

- Usuarios → cuenta del cajero → «Puede canjear entradas por una tarjeta NFC» (apagado por defecto).
- Boletería → «Canjea tu entrada por un NFC» → función. Respeta «Solo lo asignado».
- Entrada: lector USB, código escrito o cámara (Chrome en Android).
- Tarjeta: NFC del teléfono (Chrome en Android) o lector USB que escriba el número en hexadecimal (funciona como
  teclado). Cada lector se compara una vez con el teléfono; si entrega el número al revés, se configura en la pantalla.
- Migración `20261124120000_canje_por_cajeros`. Pruebas en `packages/db/test/canje-cajeros.test.ts`.
- Sin probar con aparatos: cámara, NFC del navegador y lector USB reales.
- Con esto, el rol «Canje» del punto 2 queda opcional: sirve si hace falta alguien que canjee sin vender.

## 3 bis. Carga masiva en la web: manillas nuevas (hecho, 25/11/2026)

- Boletería → «Carga masiva» en la función. Lotes en `/boleteria/lotes/<función>`.
- Dueño y administradores crean, confirman y descartan lotes; los cajeros habilitados para canjear solo leen.
- Lectura en continuo con el NFC del teléfono (Chrome en Android) o lector USB, con un tono por resultado. Avisa
  repetidas, manillas de otro lote o ya vinculadas, y el cupo lleno.
- Al confirmar se crea un lote de entradas impresas (`Manilla VIP-0001`…): todo o nada, sin duplicar.
- Migración `20261125120000_lotes_de_manillas`. Pruebas en `packages/db/test/manillas-por-lotes.test.ts`.
- Pendiente: corregir o reemplazar dentro de un lote confirmado, entradas ya vendidas (caso B), códigos impresos
  (caso C), listado por Excel y carga sin internet en la app. Sin probar con aparatos reales.
- Un lote es de una sola función (una manilla para varios días todavía no).

## 3. Carga masiva

### 3.1 Concepto: el lote

Un **lote** es: función + tipo de entrada + nombre («Manillas VIP rojas») + las lecturas en orden. Se leen todas
seguidas, se revisan y recién al **confirmar** pasan a existir en el sistema.

Tres modos, según de dónde sale la entrada:

| Modo | Caso | Qué hace al confirmar |
|---|---|---|
| **1. Manillas nuevas** | Manillas para repartir o vender en mano | Crea una entrada por manilla, numerada (A-0001…) y vinculada |
| **2. Asignar a entradas existentes** | Ya vendidas o importadas sin tarjeta | Recorre la cola de entradas sin tarjeta; cada toque se asigna a la siguiente |
| **3. Códigos impresos** | Manillas con QR o barras ya impresos | Lee en continuo con la cámara y crea las entradas con ese código |

- El modo 1 reutiliza los **lotes de entradas impresas** que ya existen: respetan el cupo, tienen número de serie y
  pueden quedar «válidas desde ya» o «se activan al vender».
- El modo 3 reutiliza la **importación de códigos externos** (hoy solo por Excel).
- En el modo 2, para entregar en mesa a una persona concreta se sigue usando el canje de una en una.

### 3.2 Pantalla de lectura (iPass Canje)

- Elegir función, tipo de entrada, color o nombre del lote y cantidad esperada.
- Acercar una tras otra, sin tocar la pantalla: sonido y vibración distintos para **bien**, **repetida** y **error**.
- Contador grande (137 de 500), último número asignado y botón «Deshacer la última».
- Lista ordenada por número, con buscador y filtros: pendientes de subir, con error, confirmadas.
- «Leer una manilla» para saber en qué lote y número está.
- Se guarda en el teléfono: si se cierra la app o se corta internet, se retoma donde quedó.

### 3.3 Panel web

- Lista de lotes por función: tipo, cantidad, quién lo cargó, estado.
- Dentro del lote: cambiar el tipo (solo sin ingresos), quitar o reemplazar una manilla, marcar perdida o dañada,
  anular el lote, exportar a Excel.
- Avance por tipo de entrada: cupo, con manilla, sin manilla, usadas.
- **Cargar un listado**: Excel o CSV con los números de serie (si el proveedor los entrega).
- **Lector USB en la computadora** (opcional): para miles de manillas es más rápido que el teléfono. Antes hay que
  probar el modelo, porque algunos entregan el número al revés o en decimal.

### 3.4 Reglas

- Una manilla no puede estar dos veces en la función: se avisa al leerla.
- No se puede pasar el cupo del tipo.
- Solo tipos con NFC (modo 3: QR o barras). Quedan fuera butacas numeradas, mesas y QR dinámico en el modo 1.
- Confirmar es repetible sin duplicar: si se corta a la mitad, se vuelve a enviar.
- Todo queda en Seguridad: quién, cuándo, qué teléfono.
- Hasta 2.000 por lote (el límite actual de impresas).

### 3.5 Datos nuevos

- `WristbandBatch`: función, tipo, nombre, modo, estado (abierto, confirmado, anulado), creador.
- `WristbandItem`: lote, número, serie o código, entrada creada o asignada, estado (leída, confirmada, rechazada,
  perdida).
- API: crear lote, subir lecturas por tandas, confirmar, listar, corregir.

## 4. Orden de trabajo

| Fase | Contenido | Tamaño | Se prueba con |
|---|---|---|---|
| 1 | Aviso de NFC (A + B) y aviso temprano de permisos | Chico | El Ulefone y un chip |
| 2 | Rol Canje (base, servidor, panel, apps) | Mediano | Una cuenta nueva |
| 3 | Lotes: servidor y modo 1 en la app | Grande | 50 manillas seguidas |
| 4 | Modos 2 y 3 | Mediano | Entradas importadas y códigos impresos |
| 5 | Panel de lotes, Excel y lector USB | Mediano | Un lote real |

- Cada fase queda usable por sí sola.
- Antes de la fase 3, medir cuánto tarda una lectura real. Como referencia sin medir: a 2 segundos por manilla, 1.000
  manillas son unos 35 minutos por persona.
- Las pruebas del servidor necesitan una base de pruebas; hoy no hay una local y las de tarjetas NFC siguen sin
  ejecutarse. Conviene resolverlo antes de la fase 2.

## 5. Decisiones pendientes

| # | Pregunta | Recomendación |
|---|---|---|
| 1 | ¿Las manillas nuevas abren la puerta apenas se cargan o al venderse? | Elegirlo por lote; por defecto, al cargarse |
| 2 | ¿Una manilla sirve para varios días? | Si hay eventos así, un lote para varias funciones (cambia el diseño: decidir antes de la fase 3) |
| 3 | ¿Quién puede cambiar una tarjeta perdida? | Canje y administradores, con registro |
| 4 | ¿Qué app atiende el chip con la app cerrada? | iPass Puerta |
| 5 | ¿Hace falta que el público no vea el aviso (opción C)? | No, por ahora |
| 6 | ¿Cuántas manillas por evento y vienen con listado del proveedor? | Define si el lector USB vale la pena |
| 7 | Nombre del rol | «Canje» |

## 6. Seguridad

El número de serie no es secreto: existen chips que lo copian. La entrada vale una sola vez y cada paso queda
registrado. Si se necesita impedir copias, hace falta otro chip (NTAG 424 DNA) y otro desarrollo.
