# Pendientes de ProShop (21-10-2026): checklist en orden

Se basa en el documento "Pendientes ProShop — IMPACTA" del 21-10-2026, revisado contra el código. Casi todo ya está
programado y tiene pruebas automáticas; lo que falta es **probarlo de punta a punta**, unos **ajustes** y algunas
**decisiones**. Cada paso se cierra con su prueba (automática en `packages/db/test` o manual en local) y la evidencia
queda anotada aquí.

Leyenda: ✅ hecho y probado · 🧪 hecho, falta probar · 🔧 falta programar · ❓ decisión pendiente

## Fase A: validar lo que ya existe

### 1. Reingreso (punto 1)

Prueba automática (22-10): `zonas-y-presencia`, `canales-y-puerta` y `app-puerta-movil`, 31 de 31 bien. Usan la misma
función de lectura que llama la app de puerta.

- [x] ✅ Entrada → salida → reingreso con el mismo QR (tipo con reingreso "Sí").
- [x] ✅ Sin reingreso: sale y no vuelve a entrar.
- [x] ✅ Estado dentro/fuera: la puerta de ida y vuelta entra o saca según si la persona está adentro; corrección
      manual (afuera / adentro / no ingresó) con historial.
- [x] ✅ Límite configurable: por **tipo de entrada** (1 ingreso, de 2 a 20, o sin límite) en Precios → Ajustes.
      Después del último ingreso puede salir pero no volver.
- [x] ✅ Recinto sin puerta de salida: la misma puerta registra la salida y la vuelta.
- [ ] ❓ La app de puerta de tu amigo debe aplicar la regla de "misma puerta" (docs/puerta-app-cambios.md §4).

### 2. Importación por Excel (puntos 2 y 9)

- [x] ✅ La plantilla trae las funciones y los tipos del evento en listas desplegables, y una hoja de ayuda
      (revisado el 22-10 con la plantilla real de "Concierto Matamba" bajada de producción).
- [ ] 🧪 Archivo correcto: vista previa sin errores, confirmar, entradas emitidas, PDF y correos.
- [x] ✅ Archivo con errores: cada fila marca su error y **no se emite nada**, ni las filas buenas (decidido el
      22-10: se quitó "importar solo las filas listas"). El panel pide corregir el Excel y subirlo de nuevo.
- [x] ✅ Volumen (22-10, en local): 5.000 filas (el máximo). Leer 8 ms, vista previa 0,3 s, confirmar **31 s**,
      deshacer 0,9 s; las 5.000 entradas emitidas y anuladas bien. Ahora las entradas comunes se emiten por bloques de
      500: confirmar 5.000 filas bajó de **31 s a 5,8 s** (prueba nueva de 1.200 filas en `importacion-excel`).
- [x] ✅ Deshacer la importación libera el cupo (prueba `importacion-excel`, 6 de 6 bien).
- [x] ✅ Comportamiento esperado documentado en [importacion-excel.md](importacion-excel.md): columnas, cada
      mensaje de error y aviso, confirmación todo o nada, entrega (PDF y correo) y deshacer.
- [ ] ❓ Probar con archivos reales de IMPACTA: hace falta que el cliente los mande.

### 3. Entradas impresas / boletería física (puntos 3 y 4)

Prueba automática (22-10): `entradas-impresas`, 6 de 6 bien. PDF generado en los 5 formatos y revisado a ojo.

- [x] ✅ Lote numerado (serie con prefijo, ej. A-0001…), descuenta cupo y no se pasa del aforo.
- [ ] 🧪 Código de verificación: cada entrada lleva su código (XXXXX-XXXXX) bajo el QR, que se puede tipear en la app
      si el QR no se lee. ❓ Confirmar con ProShop que ese es el "código de verificación" que piden.
- [x] ✅ PDF para imprimir (carta x3, A4 x3, A4 x4, térmica 80 mm e imprenta con corte) con QR, código, serie,
      talón y código de barras.
- [x] ✅ Activación al vender: por rango o por código; suma a la recaudación.
- [x] ✅ Una impresa **no vendida** se rechaza en la puerta ("Impresa sin vender").
- [x] ✅ Anular libera el cupo y la anulada no entra. Entrega a vendedores y rendición.

## Fase B: ajustes

### 4. Eventos pequeños (punto 5)

- [x] ✅ Web (22-10): el menú es "Festivales · Eventos · Boliches" y los eventos pequeños son un **filtro** dentro de
      Eventos ("Eventos pequeños", combinable con la categoría). Los enlaces viejos a /eventos-pequenos llevan al
      filtro. Probado en local con un evento marcado como pequeño.
- [x] ✅ Panel: la casilla y el recorrido explican que el evento sale con ese filtro.
- [ ] ❓ Nombre comercial definitivo: lo define el cliente (hoy "Eventos pequeños"; cambiarlo es una palabra).

### 5. Ajuste visual del panel (punto 6)

- [x] ✅ Identidad iPass: logo, colores, Poppins/Inter, menú azul noche, acciones en magenta, estados en verde/rojo.
- [ ] 🧪 Revisar pantalla por pantalla: colores, categorías, orden de los bloques y animaciones.

### 6. Recorrido guiado (punto 7)

Probado en local (23-10) entrando con cada tipo de cuenta: cada paso abre su pantalla e ilumina lo que explica.

- [x] ✅ Recorrido de 12 pasos del organizador (lo ve iPass al "Entrar" a un organizador de eventos).
- [x] ✅ Recorrido del boliche de solo lectura (6 pasos: Resumen, Noches, Ventas, Ingresos, Buscar, Listo).
- [x] ✅ Recorrido nuevo para el administrador iPass (12 pasos): Resumen general, Organizadores y boliches,
      Aprobaciones, Eventos de iPass, Clientes, Recintos, Ventas, Ingresos, Usuarios, Seguridad, Buscar, Listo.
- [x] ✅ Recorrido nuevo para cajeros: Boletería y Listo (2 pasos); en un boliche, también Barra (3 pasos).
      El cajero ahora también tiene "Ver el recorrido" en el menú.
- [ ] ❓ Lectores/porteros no entran al panel: usan la app de puerta. Su guía va en la app (de tu amigo) o en una hoja
      impresa.

### 7. Vista previa por tipo de usuario (punto 8)

- [x] ✅ (23-10) Dentro de un organizador ("Entrar"), la franja de arriba tiene **"Ver como el organizador"** y
      **"Ver como un cajero"**: el panel queda exactamente como lo ve esa cuenta (su menú, sus pantallas, su
      recorrido) y **no se puede cambiar nada** (todas las acciones exigen poder editar). "Salir de la vista previa"
      vuelve a trabajar normal. Probado en local: como organizador, sin "Usuarios" ni "Nuevo evento" y con el aviso de
      solo lectura; como cajero, solo Boletería, y si intenta abrir Ventas vuelve a Boletería.
- [ ] ❓ La vista del cliente (productora de solo lectura) depende de un cliente y un evento concretos: se revisa
      entrando con esa cuenta.

## Fase C: entrega

### 8. Prueba integral (punto 10)

- [x] ✅ Pruebas automáticas completas (23-10): 23 archivos, **199 de 199** bien (compra web, boletería, invitaciones,
      Excel, impresas, puerta, reingreso, zonas, mesas, boliches, QR dinámico, transferencias, reportes, seguridad).
- [x] ✅ En local, a mano (24-10), evento "Prueba integral iPass" en Salón Asistente Prueba:
      1. Crear y configurar: asistente completo, 2 precios (con y sin reingreso), publicado.
      2. Venta: web (orden NNXN4-D5JTH, 3 entradas), boletería (1, efectivo) e importación por Excel (con un error no
         deja importar; corregido, 3 entradas, PDF y correo).
      3. Emisión: 12 entradas con QR (3 web, 1 boletería, 3 importadas, 5 impresas).
      4. Impresión: lote P-0001 a P-0005, PDF, 2 marcadas vendidas.
      5 y 6. Puerta (dos teléfonos simulados por la API de la app, uno en la entrada y otro en la salida): con reingreso
         entra, sale y vuelve dos veces; sin reingreso sale pero no vuelve; la copia de una usada, la impresa sin vender,
         la salida de alguien que no entró y un código inventado se rechazan.
      7. Reportes: 12 emitidas, 5 ingresaron, Bs 340 (por canal: 130 web, 30 boletería, 100 impresas, 80 importadas);
         en vivo 4 adentro, 1 afuera, 2 reingresos; CSV de asistentes.
- [ ] 🧪 En producción (después de desplegar): la misma prueba con un evento de prueba, y deshacer lo creado.
