/**
 * Lo del documento "Promotores, cajeros y reportes": qué puede vender cada cajero (eventos, funciones, vigencia y medios
 * de cobro), funciones y cupo del promotor, alta en un paso, liquidación de comisiones, anulaciones con motivo,
 * conciliación de cobros y zonas (aforo que bloquea, nombres en la app de puerta, tres niveles).
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { createStaffUser } from "../src/operations/accounts";
import { getDoorDownload } from "../src/operations/mobile";
import { SIMULATED_PROVIDER, approveSimulatedPayment, assignPromoter, createPromoterAccount, promoterSales, sellAsPromoter, settlePromoterCommission } from "../src/operations/promoters";
import { parseProviderReport, paymentReconciliation } from "../src/operations/reconciliation";
import { issueGuestTickets, sellAtBoxOffice } from "../src/operations/sales";
import { salesAccess, setSalesAssignment, updateSalesSettings } from "../src/operations/sales-scope";
import { voidOrder } from "../src/operations/voids";
import { buyer, createGeneralAdmissionEvent, platformStaff } from "./fixtures";

afterAll(() => prisma.$disconnect());

const hours = (n: number) => new Date(Date.now() + n * 3_600_000);
const email = () => `cuenta-${randomCode(6).toLowerCase()}@prueba.test`;
let n = 0;

/** Un evento con dos funciones (A y B), cada una con su "General". */
async function twoSessions() {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 100, types: [{ name: "General", capacity: 100, unitAmount: 10_000 }] });
  const event = await prisma.event.findUniqueOrThrow({ where: { id: session.eventId } });
  const second = await prisma.eventSession.create({
    data: {
      eventId: event.id,
      venueId: session.venueId,
      startsAt: new Date(session.startsAt.getTime() + 86_400_000),
      ticketTypes: { create: { name: "General", sectionId: types[0]!.sectionId, unitAmount: 10_000, currency: "CLP", capacity: 100 } },
    },
    include: { ticketTypes: true },
  });
  return { event, a: { session, type: types[0]! }, b: { session: second, type: second.ticketTypes[0]! } };
}

const sale = (s: { session: { id: string }; type: { id: string } }, staffId: string, method: "EFECTIVO" | "QR" | "TARJETA" = "EFECTIVO") =>
  sellAtBoxOffice({ sessionId: s.session.id, items: [{ ticketTypeId: s.type.id, quantity: 1 }], buyer: buyer(7_000 + ++n) }, { staffId, method });

describe("qué puede vender cada cajero", () => {
  it("un cajero de siempre (todo) vende cualquier función; uno de «solo lo asignado» sin asignaciones, ninguna", async () => {
    const { event, a, b } = await twoSessions();
    const all = (await createStaffUser({ organizationId: event.organizationId, name: "Caja todo", email: email(), password: "Caja2026!", role: "CASHIER" }))!;
    await sale(a, all.id);
    await sale(b, all.id);
    const assigned = (await createStaffUser({ organizationId: event.organizationId, name: "Caja asignada", email: email(), password: "Caja2026!", role: "CASHIER", salesScope: "ASSIGNED" }))!;
    await expect(sale(a, assigned.id)).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("vende solo las funciones asignadas, dentro de su vigencia y mientras la asignación esté activa", async () => {
    const { event, a, b } = await twoSessions();
    const cashier = (await createStaffUser({ organizationId: event.organizationId, name: "Caja", email: email(), password: "Caja2026!", role: "CASHIER", salesScope: "ASSIGNED" }))!;
    await setSalesAssignment(prisma, { organizationId: event.organizationId, userId: cashier.id, eventId: event.id, sessionIds: [a.session.id] });
    await sale(a, cashier.id);
    await expect(sale(b, cashier.id)).rejects.toThrow(/No tienes asignada esta función/);

    // Evento completo: las dos.
    await setSalesAssignment(prisma, { organizationId: event.organizationId, userId: cashier.id, eventId: event.id });
    await sale(b, cashier.id);

    // Vigencia vencida o por empezar: no vende.
    await setSalesAssignment(prisma, { organizationId: event.organizationId, userId: cashier.id, eventId: event.id, endsAt: hours(-1) });
    await expect(sale(a, cashier.id)).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await setSalesAssignment(prisma, { organizationId: event.organizationId, userId: cashier.id, eventId: event.id, startsAt: hours(2) });
    await expect(sale(a, cashier.id)).rejects.toMatchObject({ code: "NOT_ALLOWED" });

    // Pausada: tampoco.
    await setSalesAssignment(prisma, { organizationId: event.organizationId, userId: cashier.id, eventId: event.id });
    await prisma.salesAssignment.updateMany({ where: { userId: cashier.id }, data: { active: false } });
    await expect(sale(a, cashier.id)).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("solo cobra con los medios permitidos de su cuenta", async () => {
    const { event, a } = await twoSessions();
    const cashier = (await createStaffUser({ organizationId: event.organizationId, name: "Caja QR", email: email(), password: "Caja2026!", role: "CASHIER" }))!;
    await updateSalesSettings({ organizationId: event.organizationId, userId: cashier.id, posMethods: ["QR"] });
    await expect(sale(a, cashier.id, "EFECTIVO")).rejects.toThrow(/no cobra con Efectivo/);
    await sale(a, cashier.id, "QR");
    // Todos marcados vuelve a "todos".
    await updateSalesSettings({ organizationId: event.organizationId, userId: cashier.id, posMethods: ["EFECTIVO", "QR", "TARJETA"] });
    expect((await salesAccess(prisma, cashier.id, event.organizationId)).posMethods).toEqual([]);
  });
});

describe("promotores: funciones, cupo, alta en un paso y liquidación", () => {
  it("vende solo sus funciones y sin pasarse de su cupo", async () => {
    const { event, a, b } = await twoSessions();
    const promoter = (await createStaffUser({ organizationId: event.organizationId, name: "Rita RRPP", email: email(), password: "Promotor2026!", role: "PROMOTER" }))!;
    await assignPromoter({ organizationId: event.organizationId, userId: promoter.id, eventId: event.id, rule: { commissionType: "PERCENT", commissionValue: 10 }, quota: 3, sessionIds: [a.session.id] });
    const sell = (s: typeof a, quantity: number) =>
      sellAsPromoter({ sessionId: s.session.id, items: [{ ticketTypeId: s.type.id, quantity }], buyer: buyer(7_500 + ++n) }, { promoterId: promoter.id, provider: SIMULATED_PROVIDER });
    await expect(sell(b, 1)).rejects.toThrow(/No tienes asignada esta función/);
    await sell(a, 2);
    await expect(sell(a, 2)).rejects.toThrow(/te quedan 1/);
    await sell(a, 1);
    await expect(sell(a, 1)).rejects.toThrow(/Ya vendiste tu cupo de 3/);
  });

  it("alta en un solo paso: cuenta, teléfono, código elegido y evento; si algo está mal no queda nada", async () => {
    const { event, a } = await twoSessions();
    const mail = email();
    const created = await createPromoterAccount({
      organizationId: event.organizationId,
      name: "Leo Promotor",
      email: mail,
      phone: "77123456",
      password: "Promotor2026!",
      code: `leo-${randomCode(4)}`,
      assignment: { eventId: event.id, rule: { commissionType: "FIXED", commissionValue: 1_000 }, quota: 50 },
    });
    expect(created.user).toMatchObject({ phone: "77123456", mustChangePassword: true });
    expect(created.code.code).toMatch(/^LEO-/);
    expect(created.assignment).toMatchObject({ commissionType: "FIXED", quota: 50 });
    const { order } = await sellAsPromoter({ sessionId: a.session.id, items: [{ ticketTypeId: a.type.id, quantity: 2 }], buyer: buyer(7_800 + ++n) }, { promoterId: created.user.id, provider: SIMULATED_PROVIDER });
    expect(order.commissionAmount).toBe(2_000);

    await expect(
      createPromoterAccount({ organizationId: event.organizationId, name: "Otro", email: mail, password: "Promotor2026!", assignment: { eventId: event.id, rule: { commissionType: "PERCENT", commissionValue: 5 } } }),
    ).rejects.toThrow(/Ya existe una cuenta/);
    const other = email();
    await expect(
      createPromoterAccount({ organizationId: event.organizationId, name: "Otro", email: other, password: "Promotor2026!", code: created.code.code, assignment: { eventId: event.id, rule: { commissionType: "PERCENT", commissionValue: 5 } } }),
    ).rejects.toThrow(/ya existe/);
    expect(await prisma.staffUser.findUnique({ where: { email: other } })).toBeNull();
  });

  it("liquidar marca sus ventas pagadas y lo nuevo queda para la próxima", async () => {
    const { event, a } = await twoSessions();
    const promoter = (await createStaffUser({ organizationId: event.organizationId, name: "Nico", email: email(), password: "Promotor2026!", role: "PROMOTER" }))!;
    await assignPromoter({ organizationId: event.organizationId, userId: promoter.id, eventId: event.id, rule: { commissionType: "PERCENT", commissionValue: 10 } });
    const admin = await platformStaff("Admin");
    const sellPaid = async (quantity: number) => {
      const { order } = await sellAsPromoter({ sessionId: a.session.id, items: [{ ticketTypeId: a.type.id, quantity }], buyer: buyer(7_900 + ++n) }, { promoterId: promoter.id, provider: SIMULATED_PROVIDER });
      await approveSimulatedPayment(order.code);
    };
    await sellPaid(1);
    await sellPaid(2);
    expect((await promoterSales(promoter.id, { organizationId: event.organizationId })).totals).toMatchObject({ commission: 3_000, toSettle: 3_000, toSettleOrders: 2 });
    const payout = await settlePromoterCommission({ organizationId: event.organizationId, promoterId: promoter.id, staffId: admin.id, note: "transferencia" });
    expect(payout).toMatchObject({ amount: 3_000, orders: 2 });
    await expect(settlePromoterCommission({ organizationId: event.organizationId, promoterId: promoter.id, staffId: admin.id })).rejects.toThrow(/No tiene comisión pendiente/);
    await sellPaid(1);
    const sales = await promoterSales(promoter.id, { organizationId: event.organizationId });
    expect(sales.totals).toMatchObject({ commission: 4_000, toSettle: 1_000 });
    expect(sales.today).toMatchObject({ tickets: 4, commission: 4_000 });
    expect(sales.payouts).toHaveLength(1);
  });
});

describe("anular o devolver una venta", () => {
  it("solo con motivo; las entradas dejan de valer y el lugar vuelve a la venta", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 2, types: [{ name: "General", capacity: 2 }] });
    const admin = await platformStaff();
    const one = { session, type: types[0]! };
    const first = await sale(one, admin.id);
    await sale(one, admin.id);
    await expect(sale(one, admin.id)).rejects.toMatchObject({ code: "SOLD_OUT" });

    await expect(voidOrder({ orderCode: first.code, organizationId: null, staffId: admin.id, reason: "no", refund: false })).rejects.toThrow(/motivo/);
    const voided = await voidOrder({ orderCode: first.code, organizationId: null, staffId: admin.id, reason: "Error de caja: cobro duplicado", refund: false });
    expect(voided).toMatchObject({ status: "CANCELLED", voidReason: "Error de caja: cobro duplicado", voidedById: admin.id });
    expect(await prisma.ticket.count({ where: { orderId: first.id, status: "CANCELLED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "order.void", entityId: first.id, severity: "warn" } })).toBe(1);
    // Su lugar vuelve a la venta.
    const third = await sale(one, admin.id);

    // Devolución: el pago queda devuelto.
    const refunded = await voidOrder({ orderCode: third.code, organizationId: null, staffId: admin.id, reason: "El cliente no puede ir", refund: true });
    expect(refunded.status).toBe("REFUNDED");
    expect(await prisma.payment.count({ where: { orderId: third.id, status: "REFUNDED" } })).toBe(1);
    await expect(voidOrder({ orderCode: third.code, organizationId: null, staffId: admin.id, reason: "otra vez lo mismo", refund: false })).rejects.toThrow(/Solo se anula/);
  });

  it("no se anula si alguien ya entró con la entrada, ni una invitación", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 5, types: [{ name: "General", capacity: 5 }] });
    const admin = await platformStaff();
    const order = await sale({ session, type: types[0]! }, admin.id);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
    expect((await scanTicket({ sessionId: session.id, raw: ticket.code })).result).toBe("ACCEPTED");
    await expect(voidOrder({ orderCode: order.code, organizationId: null, staffId: admin.id, reason: "Pidió devolución", refund: true })).rejects.toThrow(/ya se usó/);

    // Devuelve el código de la orden de cada invitado.
    const [guestOrder] = await issueGuestTickets({ ticketTypeId: types[0]!.id, guests: [{ name: "Invitada" }], staffId: admin.id });
    await expect(voidOrder({ orderCode: guestOrder!, organizationId: null, staffId: admin.id, reason: "Se canceló", refund: false })).rejects.toThrow(/invitación/);
  });
});

describe("conciliación de cobros", () => {
  it("suma lo cobrado por día y medio y compara contra el reporte de la pasarela", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10, unitAmount: 15_000 }] });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: session.eventId } });
    const admin = await platformStaff();
    const order = await sale({ session, type: types[0]! }, admin.id, "QR");
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    const from = hours(-1);
    const to = hours(1);
    const data = await paymentReconciliation({ organizationId: event.organizationId, from, to });
    expect(data.totals).toMatchObject({ count: 1, amount: 15_000 });
    expect(data.byDay).toEqual([expect.objectContaining({ provider: "pos_qr", count: 1, amount: 15_000 })]);
    expect(data.issues.paidWithoutPayment).toHaveLength(0);

    const { rows, skipped } = parseProviderReport(`referencia;monto\n${payment.providerPaymentId};150,00\nOTRO-1;99.50`);
    expect(skipped).toBe(1);
    expect(rows).toEqual([
      { reference: payment.providerPaymentId, amount: 15_000 },
      { reference: "OTRO-1", amount: 9_950 },
    ]);
    const compared = await paymentReconciliation({ organizationId: event.organizationId, from, to, provider: "pos_qr", report: rows });
    expect(compared.comparison).toMatchObject({ matched: 1, missingInReport: [], amountMismatch: [] });
    expect(compared.comparison!.missingInSystem).toEqual([{ reference: "OTRO-1", amount: 9_950 }]);
    const wrong = await paymentReconciliation({ organizationId: event.organizationId, from, to, provider: "pos_qr", report: [{ reference: payment.providerPaymentId!, amount: 14_000 }] });
    expect(wrong.comparison!.amountMismatch).toHaveLength(1);
  });
});

describe("zonas: tres niveles, aforo que bloquea y nombres en la app de puerta", () => {
  /** Boliche de prueba: General, VIP y Ultra VIP, una puerta por zona y un tipo de entrada por nivel. */
  async function club(opts: { ultraCapacity?: number; block?: boolean } = {}) {
    const { session, types } = await createGeneralAdmissionEvent({
      sectionCapacity: 100,
      types: [{ name: "General", capacity: 50 }, { name: "VIP", capacity: 30 }, { name: "Ultra VIP", capacity: 20 }],
    });
    const venueId = session.venueId;
    const general = await prisma.accessZone.create({ data: { venueId, name: "General", level: 1 } });
    const vip = await prisma.accessZone.create({ data: { venueId, name: "VIP", level: 2 } });
    const ultra = await prisma.accessZone.create({ data: { venueId, name: "Ultra VIP", level: 3, capacity: opts.ultraCapacity, blockWhenFull: opts.block ?? false } });
    const [gate1, gate2] = await prisma.accessPoint.findMany({ where: { venueId }, orderBy: { name: "asc" } });
    const doors = {
      general: await prisma.accessPoint.update({ where: { id: gate1!.id }, data: { zoneId: general.id } }),
      vip: await prisma.accessPoint.update({ where: { id: gate2!.id }, data: { zoneId: vip.id } }),
      ultra: await prisma.accessPoint.create({ data: { venueId, name: "Puerta Ultra VIP", zoneId: ultra.id } }),
    };
    const [g, v, u] = types;
    await prisma.ticketType.update({ where: { id: g!.id }, data: { zones: { connect: [{ id: general.id }] } } });
    await prisma.ticketType.update({ where: { id: v!.id }, data: { zones: { connect: [{ id: general.id }, { id: vip.id }] } } });
    await prisma.ticketType.update({ where: { id: u!.id }, data: { zones: { connect: [{ id: general.id }, { id: vip.id }, { id: ultra.id }] } } });
    const admin = await platformStaff();
    for (const [type, names] of [[g!, ["Gabi"]], [v!, ["Vale"]], [u!, ["Uri", "Ulises", "Úrsula"]]] as const) {
      await issueGuestTickets({ ticketTypeId: type.id, guests: names.map((name) => ({ name })), staffId: admin.id });
    }
    const ticket = (holderName: string) => prisma.ticket.findFirstOrThrow({ where: { sessionId: session.id, holderName } });
    const scan = async (holderName: string, gate: { id: string }) => scanTicket({ sessionId: session.id, raw: (await ticket(holderName)).code, accessPointId: gate.id });
    return { session, doors, scan, zones: { general, vip, ultra } };
  }

  it("cada entrada abre solo su nivel; el Ultra VIP pasa de General a Ultra VIP sin gastar otro ingreso", async () => {
    const { doors, scan } = await club();
    expect((await scan("Gabi", doors.ultra)).result).toBe("WRONG_GATE");
    expect((await scan("Gabi", doors.vip)).result).toBe("WRONG_GATE");
    expect((await scan("Vale", doors.ultra)).result).toBe("WRONG_GATE");
    expect(await scan("Vale", doors.vip)).toMatchObject({ result: "ACCEPTED", zone: "VIP" });
    expect(await scan("Uri", doors.general)).toMatchObject({ result: "ACCEPTED", movement: "ENTRY", zone: "General" });
    expect(await scan("Uri", doors.ultra)).toMatchObject({ result: "ACCEPTED", movement: "ZONE_CHANGE", zone: "Ultra VIP" });
  });

  it("con «bloquear al llenarse», la zona llena no deja pasar a nadie más; sin marcar, solo informa", async () => {
    const blocking = await club({ ultraCapacity: 2, block: true });
    expect((await blocking.scan("Uri", blocking.doors.ultra)).result).toBe("ACCEPTED");
    expect((await blocking.scan("Ulises", blocking.doors.ultra)).result).toBe("ACCEPTED");
    expect((await blocking.scan("Úrsula", blocking.doors.ultra)).result).toBe("ZONE_FULL");
    // Quien ya está adentro de la zona no cuenta como alguien nuevo.
    expect((await blocking.scan("Uri", blocking.doors.ultra)).result).toBe("ALREADY_USED");

    const informative = await club({ ultraCapacity: 2 });
    for (const name of ["Uri", "Ulises", "Úrsula"]) expect((await informative.scan(name, informative.doors.ultra)).result).toBe("ACCEPTED");
  });

  it("la app de puerta recibe el nombre de cada zona (campos nuevos, sin quitar los de antes)", async () => {
    const { session, doors, zones } = await club();
    const download = (await getDoorDownload({ sessionId: session.id }))!;
    expect(download.zones).toMatchObject({ [zones.general.id]: "General", [zones.vip.id]: "VIP", [zones.ultra.id]: "Ultra VIP" });
    const ultraGate = download.gates.find((g) => g.id === doors.ultra.id)!;
    expect(ultraGate).toMatchObject({ zoneId: zones.ultra.id, zoneName: "Ultra VIP", direction: "IN" });
    expect(download.gates.every((g) => "sectionIds" in g)).toBe(true);
  });

  it("la app de puerta sabe en qué zona está cada persona ahora, aunque haya entrado por otro teléfono", async () => {
    const { session, doors, scan, zones } = await club();
    const code = async (holderName: string) => (await prisma.ticket.findFirstOrThrow({ where: { sessionId: session.id, holderName } })).code;
    const uri = await code("Uri");
    const current = async () => ((await getDoorDownload({ sessionId: session.id }))!.tickets.find((t) => t.code === uri) as { zoneId?: string | null })?.zoneId ?? null;
    expect(await current()).toBeNull(); // todavía afuera
    await scan("Uri", doors.general);
    expect(await current()).toBe(zones.general.id);
    await scan("Uri", doors.ultra);
    expect(await current()).toBe(zones.ultra.id);
  });
});
