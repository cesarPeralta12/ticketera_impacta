# Tremor

Plataforma de venta de entradas y control de acceso para eventos en Bolivia, desarrollada para
el cliente **Impacta** (que aparece como organizador en el panel). Monorepo con dos apps
Next.js que comparten la base de datos y las reglas de negocio.

Integra dos trabajos: el **núcleo transaccional** (reservas sin sobreventa, pagos, entradas
con QR, control de acceso, pruebas) y el **prototipo del compañero** (login, gestión de
eventos, editor y mapa de butacas, sala de espera, diseño visual, datos bolivianos).

```
apps/web       Sitio público: eventos, compra (general y butacas), sala de espera, pago, QR, cuenta  → :3000
apps/admin     Panel: eventos, funciones, precios, recintos y mapas, órdenes, acceso, usuarios        → :3001
packages/db    Esquema Prisma, migraciones, operaciones transaccionales y pruebas de integración
packages/core  Reglas puras: dinero, estados, inventario, QR, checkout, geometría de butacas, fechas
docs/          Plan de trabajo, propuesta técnica y decisiones del Sprint 0
```

Stack: TypeScript · Next.js 16 · React 19 · Tailwind 4 · PostgreSQL · Prisma 7 · NextAuth v5 · Turborepo.

## Primer arranque

Requisitos: Node 22.12 o superior. No hace falta Docker ni instalar PostgreSQL.

```bash
npm install
cp .env.example .env      # y reemplaza cada "cambiar" (el archivo explica cómo generarlos)
```

En una terminal aparte, levanta PostgreSQL y déjala abierta:

```bash
npm run db:local
```

Es un PostgreSQL 18 real (binarios oficiales vía npm) en el puerto **5433**, para no chocar con
un PostgreSQL instalado en el 5432. Los datos quedan en `packages/db/.pgdata`. Luego:

```bash
npm run db:deploy
npm run db:seed
npm run dev
```

### Cuentas de prueba (las crea `db:seed`, solo desarrollo)

| Dónde | Email | Contraseña | Rol |
|---|---|---|---|
| Panel :3001 | `admin@impacta.test` | `Impacta2026!` | Dueño: todo el panel |
| Panel :3001 | `puerta@impacta.test` | `Puerta2026!` | Operador: solo control de acceso |
| Sitio :3000 | `comprador@impacta.test` | `Comprador2026!` | Comprador (comprar no exige cuenta) |

## Qué probar

1. **Butacas**: http://localhost:3000 → *La Deliciosa Historia del Xocolate* → Comprar → elige
   butacas en el mapa → Reservar y pagar → en la *pasarela simulada*, Aprobar → entradas con QR y butaca.
2. **Entrada general y cupo compartido**: *Loko Fest* (Preventa y General comparten el Campo).
3. **Cola virtual**: *Loko Fest* y *Alok* tienen sala de espera. Para verla esperar, baja el
   "cupo simultáneo" de la función a 1 en el panel y entra desde dos navegadores.
4. **Pago demorado**: en la pasarela, "Aprobar con webhook demorado": la orden espera la confirmación.
5. **Panel**: crea un evento → agrega una función → carga precios por sección → Publicar → aparece en el sitio.
6. **Recintos**: diseña secciones de butacas (grilla o arco) con el editor visual.
7. **Puerta**: Control de acceso → función → escribe el código bajo el QR → Enter. Repite: rechaza el reingreso.
8. **Usuarios**: crea un operador; al desactivarlo pierde el acceso en la siguiente acción.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta las dos apps |
| `npm run check` | Typecheck + lint + tests unitarios. Correr antes de cada commit |
| `npm run test:integration` | Concurrencia, pagos, butacas, cola y acceso contra PostgreSQL real (necesita `db:local`) |
| `npm run build` | Build de producción de las dos apps |
| `npm run db:migrate` | Crea y aplica una migración después de cambiar `schema.prisma` |
| `npm run db:seed` | Borra todo y carga los datos de demostración |
| `npm run db:studio` | Explorador visual de la base de datos |

## Cómo funciona lo crítico

- **Inventario**: una orden `PENDING_PAYMENT` no vencida *es* la reserva. Reservar bloquea
  (`SELECT … FOR UPDATE`) los tipos de entrada y sus secciones: las compras simultáneas de lo
  último que queda —o de la misma butaca— se atienden en fila. Respeta el cupo de cada tipo y el
  aforo compartido de la sección. Probado: 60 compras simultáneas sobre 25 lugares venden 25;
  20 personas por la misma butaca, solo una la obtiene.
- **Butacas**: elegirlas en el mapa no las bloquea; se reservan al confirmar, todas o ninguna.
  Así nadie puede acaparar el teatro sin comprar. Un índice único en la base impide emitir dos
  entradas vigentes para la misma butaca y función.
- **Cola virtual**: en Postgres (funciona con varios servidores). El token lo genera el servidor
  (cookie httpOnly) y **la creación de la orden exige un turno vigente**: no se puede saltar
  llamando a la acción directamente. La admisión se serializa: nunca entran más que el cupo.
- **Pagos**: solo el webhook verificado confirma un pago. Idempotente; resuelve el pago tardío
  (si ya no hay cupo o la butaca se vendió, la orden queda expirada y el pago se marca para reembolso).
- **Sesiones**: comprador y staff en tablas, cookies y secretos distintos. El panel verifica el
  rol contra la base en cada acción (una cuenta desactivada pierde el acceso al instante) y no
  tiene registro público: las cuentas las crea un dueño o administrador.
- **Fechas**: el organizador escribe la hora del recinto (La Paz); se guarda en UTC y se muestra
  siempre en la zona del recinto, sin importar dónde corra el servidor.

## Problemas comunes

- **Todas las páginas dan 404 salvo la portada** tras agregar rutas: caché de Turbopack
  desactualizada. Detén `npm run dev`, borra `apps/web/.next` y `apps/admin/.next`, y vuelve a levantar.
- **No se puede mover o borrar una carpeta** en Windows: el servidor de desarrollo la tiene abierta. Detenlo primero.
- **`db:local` falla al iniciar**: revisa que el puerto 5433 esté libre.

## Estado

Ver [docs/sprint-0.md](docs/sprint-0.md): avance por sprint, decisiones tomadas y pendientes.
