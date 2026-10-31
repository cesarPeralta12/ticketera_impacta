/**
 * Datos de demostración para «Conciliación de cobros»: una semana de ventas con sentido (boletería en efectivo, QR y
 * tarjeta; ventas web por pase directo) sobre los eventos que ya existen, más los casos que conviene revisar (un cobro
 * doble, pagos que llegaron cuando la reserva ya había vencido, una venta sin pago, cobros QR abandonados, una
 * devolución y una anulación) y un reporte de pasarela de ejemplo para comparar.
 *
 * Todo lo que crea se reconoce por el correo del comprador (@correo-demo.test), así se puede borrar exacto:
 *
 *   tsx prisma/demo-conciliacion.ts              crea los datos (no repite si ya están)
 *   tsx prisma/demo-conciliacion.ts --completar  sigue una carga que quedó a medias (ventas web que faltan, casos
 *                                                para revisar, reporte de pasarela y consumos leídos en barra)
 *   tsx prisma/demo-conciliacion.ts --borrar     los borra
 *
 * Usa la base de DATABASE_URL (la del .env, o la que se pase en el entorno). Solo para pruebas y demostraciones.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { DEFAULT_TIMEZONE, utcToZonedInput, zonedDateTimeToUtc } from "@ticketera/core";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
const db = await import("../src/index");
const { prisma } = db;

const DOMAIN = "correo-demo.test";
const MARK = { endsWith: `@${DOMAIN}` };

// ───────────────────────────── Borrar ─────────────────────────────
if (process.argv.includes("--borrar")) {
  const orders = await prisma.order.findMany({ where: { buyerEmail: MARK }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  await prisma.$transaction(async (tx) => {
    const tickets = await tx.ticket.findMany({ where: { orderId: { in: ids } }, select: { id: true } });
    const tIds = tickets.map((t) => t.id);
    await tx.accessScan.deleteMany({ where: { ticketId: { in: tIds } } });
    await tx.ticketTransfer.deleteMany({ where: { ticketId: { in: tIds } } });
    await tx.ticket.deleteMany({ where: { orderId: { in: ids } } });
    await tx.consumptionCredit.deleteMany({ where: { orderId: { in: ids } } });
    await tx.promoRedemption.deleteMany({ where: { orderId: { in: ids } } });
    await tx.payment.deleteMany({ where: { orderId: { in: ids } } });
    await tx.order.deleteMany({ where: { id: { in: ids } } });
    await tx.customer.deleteMany({ where: { email: MARK } });
  });
  console.log(`Borrado: ${ids.length} órdenes de demostración y sus pagos, entradas y compradores.`);
  await prisma.$disconnect();
  process.exit(0);
}

const completar = process.argv.includes("--completar");
if (!completar && (await prisma.order.count({ where: { buyerEmail: MARK } })) > 0) {
  console.log("Ya hay datos de demostración de cobros. Bórralos primero con --borrar si quieres generarlos de nuevo.");
  await prisma.$disconnect();
  process.exit(0);
}

// ───────────────────────────── Ayudas ─────────────────────────────
let seed = 20261030;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(items: readonly T[]) => items[Math.floor(rnd() * items.length)]!;
const weighted = <T,>(items: readonly (readonly [T, number])[]) => {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [item, w] of items) if ((r -= w) <= 0) return item;
  return items[0]![0];
};
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const today = utcToZonedInput(new Date(), DEFAULT_TIMEZONE).slice(0, 10);
/** Un instante de hace `daysAgo` días, a la hora y minuto de Bolivia indicados (no más tarde que ahora). */
function at(daysAgo: number, hour: number, minute: number): Date {
  const base = new Date(`${today}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() - daysAgo);
  const when = zonedDateTimeToUtc(`${base.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, DEFAULT_TIMEZONE);
  return when > new Date() ? new Date(Date.now() - between(5, 90) * 60_000) : when;
}

const FIRST = ["Rodrigo", "Camila", "Marco", "Valeria", "Diego", "Andrea", "Sebastián", "Daniela", "Gustavo", "Fernanda", "Luis", "Mariana", "Jhonny", "Carla", "Pablo", "Lucía", "Álvaro", "Natalia", "Esteban", "Paola", "Mauricio", "Gabriela", "Ariel", "Silvia"];
const LAST = ["Suárez", "Justiniano", "Rojas", "Vaca", "Mendoza", "Aguilera", "Pinto", "Salvatierra", "Quiroga", "Terceros", "Antelo", "Roca", "Cuéllar", "Rivero", "Soliz", "Montaño", "Chávez", "Peña", "Arteaga", "Zambrana"];
const EXT = ["SC", "SC", "SC", "LP", "CB", "TJ"] as const;
const usedDocs = new Set<string>();
function person() {
  const name = `${pick(FIRST)} ${pick(LAST)} ${pick(LAST)}`;
  let doc: string;
  do doc = `${between(3_100_000, 9_900_000)} ${pick(EXT)}`;
  while (usedDocs.has(doc));
  usedDocs.add(doc);
  const slug = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().split(" ");
  return { name, document: doc, email: `${slug[0]}.${slug[1]}${between(1, 99)}@${DOMAIN}`, phone: `7${between(1_000_000, 9_999_999)}` };
}

// ───────────────────────────── Qué se vende y quién cobra ─────────────────────────────
type Target = { typeId: string; sessionId: string; label: string; weight: number };
const types = await prisma.ticketType.findMany({
  where: {
    kind: "ENTRY",
    qrMode: "STATIC",
    unitAmount: { gt: 0 },
    session: { cancelledAt: null, startsAt: { gt: new Date() }, event: { status: "PUBLISHED", mode: "TICKETING", organization: { name: { in: ["iPass", "Lounge 360", "Forum Club"] } } } },
    section: { seatingMode: "GENERAL_ADMISSION" },
  },
  select: { id: true, name: true, unitAmount: true, session: { select: { id: true, startsAt: true, event: { select: { title: true, organization: { select: { name: true } } } } } } },
  orderBy: { session: { startsAt: "asc" } },
});
const target = (org: string, title: string, typeName: string, weight: number, soonest = true): Target[] => {
  const found = types.filter((t) => t.session.event.organization.name === org && t.session.event.title.startsWith(title) && t.name === typeName);
  return (soonest ? found.slice(0, 2) : found.slice(0, 1)).map((t) => ({ typeId: t.id, sessionId: t.session.id, label: `${t.session.event.title} · ${t.name}`, weight }));
};
const iPassTargets = [
  ...target("iPass", "Duky", "general", 5),
  ...target("iPass", "Duky", "vip", 2),
  ...target("iPass", "Clásico Tahuichi", "General", 3),
  ...target("iPass", "Clásico Tahuichi", "Preferencial", 1),
  ...target("iPass", "Loko Fest", "Entrada general", 3),
];
const loungeTargets = [...target("Lounge 360", "Lounge 360", "General", 4), ...target("Lounge 360", "Lounge 360", "Entrada + trago", 3)];
const forumTargets = [...target("Forum Club", "Forum", "General", 4), ...target("Forum Club", "Forum", "Entrada + chop", 3)];
const webTargets = [
  ...iPassTargets,
  ...target("iPass", "Valentina Rey", "Fase HOT", 5, false),
  ...target("iPass", "Valentina Rey", "Fase 1", 2, false),
  ...loungeTargets,
  ...forumTargets,
];

const staffBy = async (email: string) => (await prisma.staffUser.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
const cashiers = {
  ipass: await staffBy("caja@impacta.test"),
  lounge: await staffBy("barra@lounge360.test"),
  forum: await staffBy("barra@forum.test"),
};
const admin = await staffBy("admin@impacta.test");
if (iPassTargets.length + webTargets.length === 0) throw new Error("No hay funciones a la venta para generar ventas de demostración.");
const pickTarget = (list: Target[]) => weighted(list.map((t) => [t, t.weight] as const));

// ───────────────────────────── Ventas de boletería ─────────────────────────────
const posCounts = [14, 9, 4, 5, 8, 11, 6]; // de hace 6 días a hoy (hoy, hasta ahora)
const created: { code: string; kind: string }[] = [];
let failures = 0;

async function backdate(orderCode: string, createdAt: Date, paidAt: Date | null) {
  const order = await prisma.order.findUniqueOrThrow({ where: { code: orderCode }, select: { id: true } });
  await prisma.order.update({ where: { id: order.id }, data: { createdAt, ...(paidAt ? { paidAt } : {}), expiresAt: new Date(createdAt.getTime() + 10 * 60_000), updatedAt: paidAt ?? createdAt } });
  await prisma.payment.updateMany({ where: { orderId: order.id }, data: { createdAt, ...(paidAt ? { approvedAt: paidAt } : {}), updatedAt: paidAt ?? createdAt } });
  await prisma.ticket.updateMany({ where: { orderId: order.id }, data: { issuedAt: paidAt ?? createdAt } });
}

for (const [i, count] of (completar ? [] : posCounts).entries()) {
  const daysAgo = 6 - i;
  for (let n = 0; n < count; n++) {
    const branch = weighted([["ipass", 5], ["lounge", 3], ["forum", 3]] as const);
    const list = branch === "ipass" ? iPassTargets : branch === "lounge" ? loungeTargets : forumTargets;
    if (list.length === 0) continue;
    const t = pickTarget(list);
    const hour = branch === "ipass" ? between(10, 19) : between(17, 23);
    const when = at(daysAgo, hour, between(0, 59));
    const buyer = person();
    const method = weighted([["EFECTIVO", 55], ["QR", 25], ["TARJETA", 20]] as const);
    try {
      const order = await db.sellAtBoxOffice(
        { sessionId: t.sessionId, items: [{ ticketTypeId: t.typeId, quantity: weighted([[1, 40], [2, 35], [3, 15], [4, 10]] as const) }], buyer: { name: buyer.name, email: buyer.email, document: buyer.document } },
        { staffId: cashiers[branch], method, now: when },
      );
      await backdate(order.code, when, when);
      created.push({ code: order.code, kind: `caja ${method}` });
    } catch {
      failures++;
    }
  }
}

// ───────────────────────────── Ventas por la web (pase directo) ─────────────────────────────
const customers = completar
  ? await prisma.customer.findMany({ where: { email: MARK } })
  : await Promise.all(
  Array.from({ length: 22 }, async () => {
    const p = person();
    return prisma.customer.create({ data: { email: p.email, name: p.name, documentId: p.document.replace(/\s/g, "").toUpperCase(), phone: p.phone, emailVerified: true, passwordHash: await db.hashPassword("DemoCliente2026!") } });
  }),
);
const webCounts = completar ? [3, 2, 1, 1, 2, 2, 2] : [6, 4, 2, 3, 4, 5, 3];
if (completar) {
  // Retoma lo que ya está cargado para elegir qué devolver, anular, etc.
  const existing = await prisma.order.findMany({ where: { buyerEmail: MARK, status: "PAID" }, orderBy: { createdAt: "asc" }, select: { code: true, channel: true } });
  for (const o of existing) created.push({ code: o.code, kind: o.channel === "POS" ? "caja" : "web" });
}
const webOrders: string[] = completar ? created.filter((c) => c.kind === "web").map((c) => c.code) : [];

async function startedWebOrder(daysAgo: number, hour: number, minute: number) {
  const t = pickTarget(webTargets);
  const customer = pick(customers);
  const when = at(daysAgo, hour, minute);
  const order = await db.createPendingOrder(
    { sessionId: t.sessionId, items: [{ ticketTypeId: t.typeId, quantity: weighted([[1, 45], [2, 35], [3, 20]] as const) }], buyer: { name: customer.name, email: customer.email, document: customer.documentId ?? "" } },
    { customerId: customer.id, now: when },
  );
  const payment = await db.startPayment(order.code, "directo", when);
  return { order, payment, when };
}

for (const [i, count] of webCounts.entries()) {
  const daysAgo = 6 - i;
  for (let n = 0; n < count; n++) {
    try {
      const { order, payment, when } = await startedWebOrder(daysAgo, between(8, 23), between(0, 59));
      const paidAt = new Date(when.getTime() + between(40, 170) * 1000);
      await db.applyPaymentUpdate(
        { paymentId: payment.id, provider: "directo", providerPaymentId: `directo_${payment.id}`, status: "APPROVED", providerStatus: "pase_directo", amount: payment.amount, currency: payment.currency },
        paidAt,
      );
      await backdate(order.code, when, paidAt);
      webOrders.push(order.code);
      created.push({ code: order.code, kind: "web" });
    } catch {
      failures++;
    }
  }
}

// ───────────────────────────── Casos para revisar ─────────────────────────────
const issues: string[] = [];

// 1) Pagos que llegaron cuando la reserva (10 min) ya había vencido: el banco cobró y no se emitieron entradas.
for (const [daysAgo, hour] of [[3, 21], [1, 22]] as const) {
  try {
    const { order, payment, when } = await startedWebOrder(daysAgo, hour, between(0, 40));
    const late = new Date(when.getTime() + between(14, 26) * 60_000);
    await prisma.order.update({ where: { id: order.id }, data: { status: "EXPIRED", createdAt: when, expiresAt: new Date(when.getTime() + 10 * 60_000), updatedAt: late } });
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "APPROVED", providerPaymentId: `directo_${payment.id}`, providerStatus: "pase_directo", approvedAt: late, createdAt: when, updatedAt: late } });
    issues.push(`pago sin entradas: orden ${order.code} (el cliente pagó a los ${Math.round((late.getTime() - when.getTime()) / 60000)} min, ya vencida)`);
  } catch {
    failures++;
  }
}

// 2) Cobro doble: la misma venta web cobrada dos veces por la pasarela.
const doubleCode = webOrders[Math.floor(webOrders.length / 2)];
if (doubleCode) {
  const order = await prisma.order.findUniqueOrThrow({ where: { code: doubleCode }, include: { payments: true } });
  const first = order.payments[0]!;
  const second = new Date((first.approvedAt ?? new Date()).getTime() + 38_000);
  await prisma.payment.create({ data: { orderId: order.id, provider: "directo", providerPaymentId: `directo_rep_${first.id}`, status: "APPROVED", providerStatus: "pase_directo", amount: first.amount, currency: first.currency, approvedAt: second, createdAt: second, updatedAt: second } });
  issues.push(`cobro doble: orden ${doubleCode} (cobrada dos veces por Bs ${(first.amount / 100).toFixed(2)})`);
}

// 3) Una venta de boletería registrada como pagada, sin ningún pago: el cajero la cargó mal.
const lonely = created.find((c) => c.kind.startsWith("caja"));
if (lonely) {
  const order = await prisma.order.findUniqueOrThrow({ where: { code: created[Math.floor(created.length / 5)]!.code }, select: { id: true, code: true, channel: true } });
  if (order.channel === "POS") {
    await prisma.payment.deleteMany({ where: { orderId: order.id } });
    issues.push(`venta sin pago: orden ${order.code} (figura pagada y no tiene cobro registrado)`);
  }
}

// 4) Cobros QR que se abrieron y nunca se pagaron (el cliente cerró la app): se vencen solos.
for (const [daysAgo, hour] of [[5, 20], [2, 19], [0, 9]] as const) {
  try {
    const { order, payment, when } = await startedWebOrder(daysAgo, hour, between(0, 50));
    await prisma.order.update({ where: { id: order.id }, data: { status: "EXPIRED", createdAt: when, expiresAt: new Date(when.getTime() + 10 * 60_000), updatedAt: new Date(when.getTime() + 11 * 60_000) } });
    await prisma.payment.update({ where: { id: payment.id }, data: { createdAt: when, updatedAt: when } });
    issues.push(`cobro abandonado: orden ${order.code}`);
  } catch {
    failures++;
  }
}

// 5) Una devolución (el cliente se equivocó de fecha) y una anulación sin devolución (venta duplicada por el cajero).
const refundable = created.filter((c) => c.kind === "web").slice(1, 2)[0];
if (refundable) {
  await db.voidOrder({ orderCode: refundable.code, organizationId: null, staffId: admin, reason: "El cliente se equivocó de fecha y pidió la devolución", refund: true });
  issues.push(`devolución: orden ${refundable.code}`);
}
const cancellable = created.filter((c) => c.kind.startsWith("caja")).slice(4, 5)[0];
if (cancellable) {
  await db.voidOrder({ orderCode: cancellable.code, organizationId: null, staffId: admin, reason: "Venta duplicada por error del cajero", refund: false });
  issues.push(`anulación sin devolución: orden ${cancellable.code}`);
}

// ───────────────────────────── Consumos leídos en barra ─────────────────────────────
// Algunos vales de las mesas y entradas con trago/chop ya se leyeron en la barra, con su detalle y una hora de hoy.
const barDetails = ["2 botellas de ron + hielo y mezcladores", "Combo fernet + 6 vasos", "3 tragos de la casa", "Botella de vodka + energizantes", "4 chops artesanales", "Balde de cervezas (6)", "Gin tonic x4", "2 tragos + picada pequeña", "Botella de whisky + hielo"];
const barStaff: Record<string, string> = { "Lounge 360": await staffBy("barra@lounge360.test"), "Forum Club": await staffBy("barra@forum.test") };
const credits = await prisma.consumptionCredit.findMany({
  where: { order: { buyerEmail: MARK }, redeemedAt: null, amount: { gt: 0 } },
  select: { code: true, sessionId: true, session: { select: { startsAt: true, event: { select: { organization: { select: { name: true } } } } } } },
  orderBy: { session: { startsAt: "asc" } },
});
let barReads = 0;
for (const [i, c] of credits.entries()) {
  // Solo se leen los de las noches de hoy y mañana (las demás todavía no pasaron), y no todos: más o menos 6 de cada 10.
  if (c.session.startsAt.getTime() > Date.now() + 36 * 3_600_000 || i % 10 >= 6) continue;
  const staffId = barStaff[c.session.event.organization.name];
  if (!staffId) continue;
  const out = await db.redeemVoucher({ raw: c.code, sessionId: c.sessionId, staffId, note: pick(barDetails), readAt: new Date(Date.now() - between(10, 300) * 60_000) }).catch(() => null);
  if (out?.status === "REDEEMED") barReads++;
}

// ───────────────────────────── Reporte de pasarela de ejemplo ─────────────────────────────
const from = at(6, 0, 0);
const gateway = await prisma.payment.findMany({ where: { provider: "directo", status: { in: ["APPROVED", "REFUNDED"] }, approvedAt: { gte: from } }, orderBy: { approvedAt: "asc" }, select: { providerPaymentId: true, amount: true } });
const lines = gateway.filter((p) => p.providerPaymentId).map((p) => ({ reference: p.providerPaymentId!, amount: p.amount }));
// El banco no reportó uno de los cobros normales (el cobro doble sí figura dos veces: el banco lo cobró de verdad).
const droppedAt = lines.findIndex((l, i) => i >= Math.floor(lines.length / 3) && !l.reference.includes("_rep_"));
const dropped = lines.splice(droppedAt, 1)[0];
const short = lines.find((l, i) => i >= Math.floor(lines.length / 2) && !l.reference.includes("_rep_"))!; // el banco liquidó menos (comisión descontada por error)
short.amount -= 500;
lines.push({ reference: "directo_cm_8f3k2lq9", amount: 18000 }, { reference: "directo_cm_2p7w5xd1", amount: 42000 }); // cobros que el sistema no tiene
const report = `referencia;monto\n${lines.map((l) => `${l.reference};${(l.amount / 100).toFixed(2).replace(".", ",")}`).join("\n")}\n`;
const reportPath = path.resolve(import.meta.dirname, "../../../../docs/reporte-pasarela-demo.txt");
await writeFile(reportPath, report, "utf8").catch(() => writeFile(path.resolve(import.meta.dirname, "reporte-pasarela-demo.txt"), report, "utf8"));

// ───────────────────────────── Resumen ─────────────────────────────
const range = { from, to: new Date(Date.now() + 3_600_000) };
const result = await db.paymentReconciliation({ organizationId: null, ...range });
const money = (c: number) => `Bs ${(c / 100).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
console.log(`Ventas creadas: ${created.length} (${created.filter((c) => c.kind.startsWith("caja")).length} de caja, ${created.filter((c) => c.kind === "web").length} web). Intentos que no se pudieron vender: ${failures}.`);
console.log(`Cobrado en el período: ${result.totals.count} pagos, ${money(result.totals.amount)}`);
const byProvider = new Map<string, number>();
for (const d of result.byDay) byProvider.set(d.provider, (byProvider.get(d.provider) ?? 0) + d.amount);
console.log([...byProvider].map(([p, a]) => `  ${p}: ${money(a)}`).join("\n"));
console.log(`Consumos leídos en barra: ${barReads} de ${credits.length}.`);
console.log(`Para revisar: ${issues.length} casos\n  - ${issues.join("\n  - ")}`);
console.log(`Reporte de pasarela de ejemplo (${lines.length} líneas; falta una, una con menos monto y dos de más): ${reportPath}`);
console.log(`Referencia que el banco no reportó: ${dropped?.reference}`);
await prisma.$disconnect();
