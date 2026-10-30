# Revisión del sistema y plan de mejoras

Fecha: 13 de octubre de 2026 · Rama revisada: `feature/puerta-flutter` + `origin/main` fusionada (local, sin subir).

## 1. Qué trae `main` (lo que subió Cesar)
| Commit | Qué agrega |
|---|---|
| `94088ca` | Compradores, exportación a Excel, invitados desde `.xlsx`, *Mis eventos* y transferencias |
| `954d932` | Fusión de nuestra rama (app de puerta, promociones, QR dinámico, correo, seguridad) |
| `623199c` | **Boliches**: mesas con consumo, barra, entrada *free* por horario, noches que se repiten |
| `9e5b448` | Organizadores de **solo lectura**, boliches como tipo de organizador, mesas elegidas en el mapa |
| `7864edf` | La semilla de demostración salta cuentas sin carnet o sin correo confirmado |

Son 78 archivos y 3 migraciones nuevas (`boliches`, `organizador_boliche`, `mesas_en_mapa`).

### Fusión con nuestra rama
Se fusionó `main` en local: **4 conflictos**, todos resueltos y verificados.
- Mapa del recinto (panel): se conservó el editor unificado y se mantuvo la vista de solo lectura de `main`, ahora con puertas y zonas sin forma.
- Compra (web) y página de la función: se combinaron los imports y el título de "mesas" de `main` con nuestras puertas.
- Acciones de venues: la acción nueva de puertas pasó a `requireEditor()` (los organizadores de solo lectura no escriben).

## 2. Resultado de la verificación
| Qué | Resultado |
|---|---|
| Tipos y lint (13 tareas) | ✅ sin errores |
| Pruebas núcleo, correo y web | ✅ pasan |
| Pruebas de base de datos (Postgres real) | ✅ **167** pasan (incluye las de boliches) |
| App de puerta (Flutter) | ✅ análisis limpio, **32** pruebas |
| Compilación de producción (sitio y panel) | ✅ |
| Migraciones sobre la base local | ✅ las 3 de `main` + la nuestra |
| Sitio público: portada, filtros, búsqueda, boliches, login, registro, manifest, SW | ✅ 200 (0,1–1,1 s en desarrollo) |
| Panel con sesión: 14 secciones principales + 29 páginas de detalle (eventos, funciones, ingreso en vivo, recintos, organizadores, usuarios, promociones, barra, compradores) | ✅ 200, sin errores en pantalla |
| API móvil: login, funciones asignadas, descarga | ✅ |
| Seguridad: origen ajeno a `/api/v1`, cabeceras (CSP, anti-iframe) | ✅ 403 / presentes |

Observaciones sin gravedad:
- Las páginas de eventos, recintos y usuarios **de otro organizador** dan 404 al abrirlas desde la vista general de Impacta. Es lo diseñado: para verlas se entra al organizador ("Entrar como").
- `/cliente` redirige para quien no es rol cliente (esperado).

### Lo que NO pude comprobar desde aquí
- Un celular real leyendo QR (cámara, NFC y modo avión).
- Correo real con tu dominio (depende de la verificación en Resend y de las variables de producción).
- Carga: no hay pruebas de concurrencia masiva de la cola ni de la compra.
- El módulo de **boliches** (mesas, barra, free por horario) se revisó por sus pruebas, pero no lo recorrí a mano en el navegador.

## 3. Riesgos y deuda detectados
| # | Hallazgo | Riesgo |
|---|---|---|
| 1 | **El pago es "pase directo"**: aprueba sin cobrar | Alto si se usa para vender |
| 2 | Secretos que pasaron por el chat (clave de Resend, contraseña de Postgres, secretos de sesión y de QR) | Alto: hay que rotarlos |
| 3 | Postgres con puerto público y la app conectada con el usuario `postgres` | Alto |
| 4 | **Sin copias de seguridad automáticas** (Coolify pide almacenamiento S3 y no está configurado) | Alto |
| 5 | `npm audit`: **9 vulnerabilidades altas** (next, next-auth→nodemailer, prisma→mysql2/deepmerge, source-map-js) | Medio: casi todas son de herramientas, pero `next` y `nodemailer` van en producción |
| 6 | Sin monitoreo de errores ni alertas (solo `/api/health`) | Medio |
| 7 | Portada y eventos: varias consultas por evento para calcular lo que queda | Medio al crecer |
| 8 | Imágenes de eventos solo por URL externa (sin subida ni optimización) | Medio |
| 9 | La CSP usa `unsafe-inline` (Next incrusta scripts sin nonce) | Bajo |
| 10 | La APK se firma con la clave de depuración; sin Play Store ni iOS | Bajo ahora |
| 11 | Rama larga `feature/puerta-flutter`: ya costó 4 conflictos | Medio de proceso |
| 12 | El CI corre en `main` y en PR, pero no hay protección de rama ni revisión obligatoria | Bajo |
| 13 | Avisos de fin de línea (CRLF/LF) en cada commit | Ruido |

## 4. Mejoras propuestas, por prioridad

### P0 — antes de vender de verdad o de mostrarlo a terceros
1. **Rotar secretos**: clave de Resend, contraseña de Postgres, `WEB_AUTH_SECRET`, `ADMIN_AUTH_SECRET` y `TICKET_QR_SECRET`. Este último invalida los QR emitidos, por eso se hace **antes** de la primera venta real.
2. **Base de datos**: cerrar el puerto público, crear un usuario de aplicación con los mínimos privilegios (distinto de `postgres`) y activar **copias diarias** con una restauración de prueba.
3. **Pasarela de pago real** con conciliación, reembolsos y webhook firmado (ya está preparada la interfaz; falta elegir proveedor). Mientras tanto, mostrar un aviso "modo demostración" y **bloquear** `PAYMENT_PROVIDER=directo` si el servidor está marcado como producción real.
4. **Actualizar dependencias** vulnerables (`next`, `next-auth`/`nodemailer`, `prisma`) y fijar `npm audit` en el CI.
5. **Monitoreo**: Sentry (sitio, panel y app de puerta) y una alerta de caída del `/api/health`.

### P1 — calidad y confianza (2–3 semanas)
6. **Pruebas de extremo a extremo** con Playwright: compra con cola, código promocional, transferencia, QR dinámico y lectura en puerta; correrlas en el CI.
7. **Prueba de carga** (k6): 1.000 compradores a la vez en la cola y la compra; confirmar que no se sobrevende ni se agotan las conexiones.
8. **Rendimiento**: guardar en caché el listado de la portada (30–60 s), calcular disponibilidad con una sola consulta por lote, índices revisados con `EXPLAIN`, y medir con Lighthouse.
9. **Imágenes**: subir y recortar la portada del evento en el panel, con almacenamiento y CDN.
10. **Proceso**: merge frecuente de `main` (semanal), PR obligatorio con el CI verde, protección de `main` y un solo estilo de fin de línea (`.gitattributes` con `eol=lf`).
11. **Revisar el módulo de boliches** con el cliente (flujo completo de mesas y barra) y conectar su lectura en la app de puerta.

### P2 — producto (1–2 meses)
12. **Recordatorio por correo** del QR dinámico (día anterior, con tarea programada).
13. **App de puerta**: búsqueda por CI como respaldo, versión mínima exigida por el servidor, firma propia, Play Store, iPhone, y a futuro Play Integrity y *certificate pinning*.
14. **Panel**: liquidación a organizadores, comisión o cargo por servicio configurable, 2FA para dueños y administradores, y auditoría de cambios con "antes y después".
15. **Portada y evento**: SEO (etiquetas para compartir, `sitemap`, datos estructurados de evento), "También te puede gustar", compartir por WhatsApp y favoritos.
16. **Accesibilidad**: auditoría WCAG de compra y entradas.

### P3 — más adelante
17. Entradas en Google Wallet y Apple Wallet; pulseras NFC.
18. Reventa oficial con tope de precio; lista de espera.
19. Varios idiomas y monedas.

## 5. Planning sugerido
| Semana | Foco | Resultado |
|---|---|---|
| 1 | P0 (1–5) | Servidor seguro, con copias, alertas y sin vulnerabilidades altas |
| 2 | Pasarela de pago (3) + E2E de compra (6) | Compra real probada de punta a punta |
| 3 | Carga (7), rendimiento (8), proceso (10) | Se sabe cuánto aguanta y el CI protege `main` |
| 4 | Imágenes (9), boliches con el cliente (11), recordatorio (12) | Producto completo para el primer evento |
| 5–6 | App de puerta (13) y panel (14) | Operación del día del evento más robusta |
| 7+ | P2 restante y P3 | Según lo que pida el cliente |

## 6. Decisiones que necesito de ti
1. ¿Subo la rama fusionada y abro un PR hacia `main`, o prefieres revisarla primero?
2. ¿Qué pasarela de pago prefiere el cliente (Bolivia: QR interbancario, tarjeta, billetera)?
3. ¿Cuándo es el primer evento real? Define cuánto de P0 y P1 hay que tener listo.
4. ¿Quién administra el servidor y las copias (tú o el cliente)?
