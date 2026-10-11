# QR dinámico (plan)

Estado: **implementado en local** (fases 1 a 5; sin subir al servidor). Opción elegida: secreto compartido por entrada (estilo TOTP), con validación sin internet.

### Qué quedó hecho
- Núcleo (`packages/core/src/dynamic-qr.ts`) y app de puerta (`apps/puerta_app/lib/dynamic_qr.dart`) con **vectores de prueba idénticos** (TypeScript y Dart calculan lo mismo).
- Servidor: `qrMode` por tipo de entrada, lectura `TK2`/código+OTP, resultados `QR_EXPIRED` y `STATIC_NOT_ALLOWED`, re-verificación de lecturas sin conexión, llaves en la descarga de la puerta (solo las de su puerta).
- Panel: interruptor por tipo de entrada (bloqueado tras la primera venta), boletería e invitaciones lo rechazan, contador de “QR vencidos” en el ingreso en vivo.
- Comprador: `/entrada/[código]` (QR calculado en el celular con anillo vivo y OTP de respaldo), `/api/entradas/[código]/llave`, service worker + manifest (PWA), preparación automática en *Mis entradas*, correo sin QR con botón “Abrir mi entrada”, borrado al cerrar sesión.
- Probado de punta a punta en local: el OTP del navegador coincide con el del servidor, una captura de hace 10 min da `QR_EXPIRED`, el código estático da `STATIC_NOT_ALLOWED`, el QR vivo entra, y la página abre **sin servidor** desde la caché (compilación de producción).

### Pendiente
- **Recordatorio por correo el día anterior** (“abre tu entrada con internet”): requiere una tarea programada y un campo `reminderSentAt`; no está hecho.
- Probar con celulares reales en modo avión y una APK nueva (el APK actual no entiende `TK2`).
- Cambiar el modo del QR de un tipo con ventas, y el esquema asimétrico: fuera de alcance (ver más abajo).


## 1. Idea en una línea
La entrada es siempre la misma (`código`). Lo que cambia cada 30 segundos es una **prueba** calculada con un secreto propio de esa entrada. La puerta, que descarga el secreto antes del evento, recalcula la prueba sin internet y compara. Una captura de pantalla vieja no pasa.

## 2. Decisiones tomadas
| Tema | Decisión |
|---|---|
| Esquema | Secreto compartido por entrada (HMAC por tiempo). Asimétrico (Ed25519) queda para una versión futura |
| Paso | 30 segundos; la puerta acepta el paso actual y uno antes y uno después (≈ 90 s de margen) |
| Dónde se activa | Por **tipo de entrada** (ej. VIP dinámico, General estático). Se bloquea el cambio cuando ya hay ventas |
| Métodos de lectura | Un tipo dinámico admite **solo QR** (sin código de barras ni NFC) |
| Comprador | Página web instalable (PWA) que genera el QR en su celular y funciona sin internet |
| Venta | Los tipos dinámicos son solo para venta online. Boletería (impresa) e invitaciones usan tipos estáticos |

## 3. Formato y criptografía
Archivo nuevo `packages/core/src/dynamic-qr.ts` (WebCrypto: corre igual en servidor, navegador y pruebas).

```
llave   = HMAC-SHA256(TICKET_QR_SECRET, "dyn1|" + código)        // 16 bytes, derivada, no se guarda
paso    = floor((hora_ms + desfase_ms) / 30000)
prueba  = HMAC-SHA256(llave, "TK2|" + código + "|" + paso)       // primeros 8 bytes → base64url (11 car.)
QR      = "TK2." + código + "." + paso(base36) + "." + prueba     // ≈ 32 caracteres
manual  = código + OTP de 6 dígitos  (de la misma prueba, como un TOTP)
```

- **La llave se deriva del código**, así que al transferir una entrada (que ya cambia el código) la llave cambia sola y la anterior queda inútil.
- La llave usa una etiqueta distinta (`dyn1|`) de la firma estática (`TK1.`): no se pueden confundir.
- La puerta recibe **solo llaves**, nunca el secreto maestro.
- Comparación en tiempo constante. Prueba de 64 bits: un atacante en la puerta no puede probarlas todas.
- **Vectores de prueba compartidos** (código, llave, paso → prueba esperada) en las pruebas de TypeScript y de Dart, para garantizar que los dos cálculos coinciden.

## 4. Base de datos (migración aditiva)
- `enum QrMode { STATIC DYNAMIC }` y `TicketType.qrMode` (por defecto `STATIC`).
- `ScanResult`: valores nuevos `QR_EXPIRED` (la prueba es de otro paso: captura vieja) y `STATIC_NOT_ALLOWED` (se leyó código estático en un tipo dinámico).
- Nada se guarda por entrada: la llave se deriva al momento.

## 5. Servidor
- `scanTicket`: si el QR es `TK2`, verifica la prueba con la hora del servidor. Si el tipo es dinámico y llega `TK1` o el código solo, rechaza con `STATIC_NOT_ALLOWED`. Un código manual solo vale con el OTP.
- `getDoorDownload`: para entradas de tipos dinámicos **de las secciones de esa puerta** agrega `key` (base64url) y devuelve `serverTime` para calibrar el reloj. Las demás entradas no llevan llave.
- Al sincronizar lecturas hechas sin conexión, el servidor **vuelve a verificar la prueba** del QR guardado. Si no cuadra, queda una alerta de seguridad (puerta modificada o falsificación).
- `GET /api/entradas/[código]/llave` (sitio, requiere sesión del dueño de la entrada): entrega `{ llave, serverTime, venceEn }`. Límite de intentos, y cada entrega queda en el registro de seguridad (`ticket.key_issued`, con IP y dispositivo). Muchos dispositivos distintos para una misma entrada generan alerta.
- Crear o editar un tipo dinámico fuerza `accessMethods = [QR]` y lo excluye de la boletería.

## 6. App de puerta (Flutter)
- `validator.dart`: lee `TK2.<código>.<paso>.<prueba>`, busca la entrada, calcula la prueba con la llave guardada (paquete `crypto`) y la compara para el paso actual ±1.
- Reloj: al descargar se guarda `desfase = serverTime − hora_del_teléfono`. La puerta usa su hora más ese desfase, así no depende de que el reloj del teléfono esté bien.
- Veredictos nuevos y mensajes claros: **QR vencido** (“pídele que espere al siguiente QR; una captura no sirve”) y **Exige QR dinámico** (“que abra su entrada en la app”).
- Entrada manual: código + OTP de 6 dígitos.
- Las llaves se guardan **cifradas** (AES-GCM con una clave en Android Keystore, vía `flutter_secure_storage`) y se borran al cerrar sesión, como el resto de la lista.
- Pruebas: vectores compartidos, vencido, adelantado, paso ±1, tipo dinámico con código estático, reloj desfasado.

## 7. Comprador (lo más grande)
Página nueva `/entrada/[código]` dentro de **Mis entradas**:

1. Con internet pide la llave y la hora del servidor; guarda llave y desfase en **IndexedDB**.
2. En el celular genera el QR cada 30 s con WebCrypto, **sin internet**, y lo dibuja con un anillo de cuenta regresiva animado (así una captura se nota vieja).
3. Muestra el OTP de 6 dígitos debajo (respaldo manual).
4. Es una **PWA**: `manifest` + service worker que guardan la página y las entradas, con el aviso “Listo para usar sin internet ✓” y la invitación a instalarla.
5. Con la entrada ya cacheada, abre aunque el estadio no tenga señal.
6. Si cambió de titular (transferencia), la llave vieja se descarta en la siguiente sincronización.
7. El correo de la compra **no lleva QR** para tipos dinámicos: trae el botón “Abrir mi entrada” y la instrucción de abrirla con internet antes de salir. Recordatorio por correo el día anterior.

## 8. Panel de administración
- En el tipo de entrada: interruptor **QR dinámico** (con explicación), que muestra “solo QR, solo venta online” y se bloquea tras la primera venta.
- Insignia del tipo en el evento y en el ingreso en vivo.
- Contador de **“QR vencidos”** (intentos con captura) en el ingreso en vivo y en la pantalla Seguridad.
- Boletería: oculta los tipos dinámicos.

## 9. Fases y esfuerzo
| Fase | Qué | Días |
|---|---|---|
| 0 | Vectores de prueba y decisiones finales | 0,5 |
| 1 | Núcleo (`dynamic-qr.ts`), migración, `scanTicket`, descarga con llaves, re-verificación al sincronizar | 1 |
| 2 | App de puerta: verificación offline, cifrado de llaves, veredictos y pruebas | 1,5 |
| 3 | Comprador: llave, página, QR en el navegador, PWA/offline, correo | 2–3 |
| 4 | Panel: interruptor, bloqueos, contadores, boletería | 1 |
| 5 | Pruebas de punta a punta (con celulares reales en modo avión), endurecimiento, documentación | 1 |
| | **Total** | **≈ 7–8** |

Orden recomendado: 1 → 2 → 4 → 3 → 5. Así la puerta y el panel se pueden probar con un QR generado por un script antes de construir la parte del comprador.

## 10. Riesgos y qué hacemos
| Riesgo | Mitigación |
|---|---|
| El comprador sin internet no puede abrir su entrada | PWA con llave cacheada, aviso “Listo sin internet”, correo previo, y probar en modo avión |
| Relojes desajustados | Ambos lados se calibran con la hora del servidor al sincronizar; ventana ±1 paso |
| Compartir la llave (otro celular con la misma entrada) | La primera lectura gana (una sola entrada); límite y registro de entregas de llave; es la limitación del secreto compartido (solución: asimétrico, fase futura) |
| Robo o root de un celular de puerta | Llaves cifradas, solo de las secciones de su puerta, se borran al cerrar sesión, sesiones revocables |
| Compartir la pantalla en vivo | No lo evita ningún QR; la transferencia oficial sigue disponible |
| Dos puertas sin internet leen la misma entrada | Igual que hoy: queda como doble ingreso; las puertas por sección lo reducen |
| Cambiar el modo con entradas vendidas | Bloqueado tras la primera venta |
| Diferencia entre las implementaciones TypeScript y Dart | Vectores de prueba compartidos |

## 11. Fuera de alcance (por ahora)
- Esquema asimétrico (Ed25519) y claves atadas al dispositivo del comprador.
- Billeteras (Google Wallet admite códigos rotatorios; Apple Wallet requiere cuenta de Apple Developer).
- NFC dinámico y código de barras dinámico.
- Búsqueda por CI en la puerta como respaldo si el celular del comprador está muerto (recomendada como mejora aparte).
