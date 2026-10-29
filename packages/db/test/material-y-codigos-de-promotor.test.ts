/**
 * Material promocional (se descarga tal cual y vence a los 30 días del evento) y códigos ligados a una cuenta de
 * promotor (nunca a un nombre suelto).
 */
import { afterAll, describe, expect, it } from "vitest";
import { PROMO_ASSET_MAX_BYTES, PROMO_ASSET_RETENTION_DAYS, promoAssetType, randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { createStaffUser } from "../src/operations/accounts";
import {
  addPromoAsset,
  deletePromoAsset,
  getPromoAssetFile,
  listPromoAssets,
  promoAssetsForPromoter,
  purgeExpiredPromoAssets,
} from "../src/operations/promo-assets";
import { SIMULATED_PROVIDER, assignPromoter, sellAsPromoter } from "../src/operations/promoters";
import { createPromoCode, listPromoCodes, listPromoterAccounts, summarizeByPromoter, updatePromoCode } from "../src/operations/promos";
import { buyer, createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

const unique = () => randomCode(6).toLowerCase();
const DAY = 86_400_000;

async function setup() {
  const { session } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10, unitAmount: 10_000 }] });
  const event = await prisma.event.findUniqueOrThrow({ where: { id: session.eventId } });
  const orgId = event.organizationId;
  const account = (role: "PROMOTER" | "ADMIN", name: string) =>
    createStaffUser({ organizationId: orgId, name, email: `${role.toLowerCase()}-${unique()}@prueba.test`, password: "Cuenta2026!", role });
  const admin = (await account("ADMIN", "Admin"))!;
  const assigned = (await account("PROMOTER", "Luis Vargas"))!;
  const other = (await account("PROMOTER", "Sin evento"))!;
  await assignPromoter({ organizationId: orgId, userId: assigned.id, eventId: event.id, rule: { commissionType: "PERCENT", commissionValue: 10 } });
  return { session, event, orgId, admin, assigned, other };
}

/** Bytes de un PNG de prueba con relleno: lo que se sube es exactamente lo que se baja. */
const png = (extra = 2_000) => {
  const bytes = new Uint8Array(8 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 8; i < bytes.length; i++) bytes[i] = (i * 31) % 256;
  return bytes;
};

describe("material promocional", () => {
  it("el promotor con el evento asignado baja el original, byte a byte", async () => {
    const { event, orgId, admin, assigned } = await setup();
    const original = png(300_000);
    const asset = await addPromoAsset(orgId, event.id, { fileName: "flyer final.png", mimeType: "image/png", data: original, width: 4000, height: 5000 }, admin.id);
    const file = await getPromoAssetFile(asset.id, { organizationId: orgId, userId: assigned.id, asManager: false });
    expect(file?.fileName).toBe("flyer final.png");
    expect(file?.mimeType).toBe("image/png");
    expect(Buffer.compare(Buffer.from(file!.data), Buffer.from(original))).toBe(0);
    const listed = await listPromoAssets(orgId, event.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ byteSize: original.length, width: 4000, height: 5000 });
  });

  it("un promotor sin ese evento asignado no lo ve ni lo baja; tampoco otra organización", async () => {
    const { event, orgId, admin, other } = await setup();
    const asset = await addPromoAsset(orgId, event.id, { fileName: "a.png", mimeType: "image/png", data: png() }, admin.id);
    expect(await getPromoAssetFile(asset.id, { organizationId: orgId, userId: other.id, asManager: false })).toBeNull();
    expect((await promoAssetsForPromoter(other.id, orgId)).size).toBe(0);
    expect(await getPromoAssetFile(asset.id, { organizationId: "otra-organizacion", userId: other.id, asManager: true })).toBeNull();
  });

  it("solo imágenes y videos, hasta 25 MB; un archivo nuevo reemplaza al anterior", async () => {
    const { event, orgId, admin } = await setup();
    const first = await addPromoAsset(orgId, event.id, { fileName: "video.mp4", mimeType: "video/mp4", data: new Uint8Array(1024) }, admin.id);
    await expect(addPromoAsset(orgId, event.id, { fileName: "x.pdf", mimeType: "application/pdf", data: new Uint8Array(10) }, admin.id)).rejects.toThrow(/imagen/);
    await expect(addPromoAsset(orgId, event.id, { fileName: "x.png", mimeType: "image/png", data: new Uint8Array(0) }, admin.id)).rejects.toThrow(/vacío/);
    await expect(
      addPromoAsset(orgId, event.id, { fileName: "x.mov", mimeType: "video/quicktime", data: new Uint8Array(PROMO_ASSET_MAX_BYTES + 1) }, admin.id),
    ).rejects.toThrow(/25 MB/);
    const second = await addPromoAsset(orgId, event.id, { fileName: "flyer.png", mimeType: "image/png", data: png() }, admin.id);
    expect((await listPromoAssets(orgId, event.id)).map((a) => a.id)).toEqual([second.id]);
    expect(await prisma.eventPromoAsset.count({ where: { id: first.id } })).toBe(0);
  });

  it("reconoce imágenes y videos por sus bytes, no por la extensión", () => {
    expect(promoAssetType(png())).toBe("image/png");
    expect(promoAssetType(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]))).toBe("video/mp4");
    expect(promoAssetType(new TextEncoder().encode("%PDF-1.7 documento"))).toBeNull();
    expect(promoAssetType(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
  });

  it("deja de estar disponible 30 días después de la última función y se borra", async () => {
    const { event, orgId, admin, assigned, session } = await setup();
    const asset = await addPromoAsset(orgId, event.id, { fileName: "a.png", mimeType: "image/png", data: png() }, admin.id);
    const ends = (await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id } })).startsAt;
    const who = { organizationId: orgId, userId: assigned.id, asManager: false };
    const inside = new Date(ends.getTime() + (PROMO_ASSET_RETENTION_DAYS - 1) * DAY);
    const outside = new Date(ends.getTime() + (PROMO_ASSET_RETENTION_DAYS + 1) * DAY);
    expect(await getPromoAssetFile(asset.id, who, inside)).not.toBeNull();
    expect(await getPromoAssetFile(asset.id, who, outside)).toBeNull();
    expect((await promoAssetsForPromoter(assigned.id, orgId, outside)).size).toBe(0);
    await purgeExpiredPromoAssets(outside);
    expect(await prisma.eventPromoAsset.count({ where: { id: asset.id } })).toBe(0);
  });

  it("borrar un archivo lo quita", async () => {
    const { event, orgId, admin } = await setup();
    const asset = await addPromoAsset(orgId, event.id, { fileName: "a.png", mimeType: "image/png", data: png() }, admin.id);
    await deletePromoAsset(orgId, asset.id, admin.id);
    expect(await listPromoAssets(orgId, event.id)).toHaveLength(0);
    await expect(deletePromoAsset(orgId, asset.id, admin.id)).rejects.toThrow(/no encontrado/i);
  });
});

describe("códigos ligados a una cuenta de promotor", () => {
  it("un código con promotor toma el nombre de su cuenta y no guarda porcentaje aparte", async () => {
    const { orgId, admin, assigned } = await setup();
    const promo = await createPromoCode(
      orgId,
      { code: `LIGADO-${unique()}`, discountType: "PERCENT", discountValue: 10, promoterId: assigned.id, promoterName: "Texto suelto", commissionPercent: 50 },
      admin.id,
    );
    expect(promo).toMatchObject({ promoterId: assigned.id, promoterName: "Luis Vargas", commissionPercent: null });
  });

  it("solo se puede ligar una cuenta de promotor activa de la misma organización", async () => {
    const { orgId, admin } = await setup();
    const otherOrg = await setup();
    const input = { discountType: "PERCENT" as const, discountValue: 10 };
    await expect(createPromoCode(orgId, { ...input, code: `X-${unique()}`, promoterId: otherOrg.assigned.id }, admin.id)).rejects.toThrow(/cuenta/);
    await expect(createPromoCode(orgId, { ...input, code: `Y-${unique()}`, promoterId: admin.id }, admin.id)).rejects.toThrow(/cuenta/); // un admin no es promotor
    await prisma.staffUser.update({ where: { id: otherOrg.assigned.id }, data: { active: false } });
    const { assigned } = await setup();
    await prisma.staffUser.update({ where: { id: assigned.id }, data: { active: false } });
    await expect(createPromoCode(orgId, { ...input, code: `Z-${unique()}`, promoterId: assigned.id }, admin.id)).rejects.toThrow(/cuenta/);
  });

  it("la lista para elegir promotor solo trae cuentas de promotor activas de la organización", async () => {
    const { orgId, assigned, other, admin } = await setup();
    const ids = (await listPromoterAccounts(orgId)).map((a) => a.id);
    expect(ids).toContain(assigned.id);
    expect(ids).toContain(other.id);
    expect(ids).not.toContain(admin.id);
  });

  it("el reporte agrupa por cuenta aunque el nombre cambie; un código antiguo sin cuenta se marca y se puede ligar", async () => {
    const { orgId, admin, assigned } = await setup();
    const a = await createPromoCode(orgId, { code: `A-${unique()}`, discountType: "PERCENT", discountValue: 10, promoterId: assigned.id }, admin.id);
    await createPromoCode(orgId, { code: `B-${unique()}`, discountType: "PERCENT", discountValue: 5, promoterId: assigned.id }, admin.id);
    const legacy = await createPromoCode(orgId, { code: `C-${unique()}`, discountType: "PERCENT", discountValue: 5, promoterName: "Luis V.", commissionPercent: 10 }, admin.id);
    await prisma.staffUser.update({ where: { id: assigned.id }, data: { name: "Luis Vargas Rojas" } });

    const rows = (await listPromoCodes(orgId)).filter((r) => [a.id, legacy.id].includes(r.id) || r.promoterId === assigned.id);
    const summary = summarizeByPromoter(rows);
    expect(summary.filter((s) => s.promoterId === assigned.id)).toHaveLength(1);
    expect(summary.find((s) => s.promoterId === assigned.id)?.codes).toBe(3); // los 2 de arriba + su código personal
    expect(summary.find((s) => s.promoterId === null)?.promoter).toBe("Luis V."); // el antiguo no se mezcla

    // Sin elegir cuenta, conserva su nombre; con cuenta, se liga.
    const same = await updatePromoCode(orgId, legacy.id, { promoterId: null }, admin.id);
    expect(same).toMatchObject({ promoterId: null, promoterName: "Luis V." });
    const linked = await updatePromoCode(orgId, legacy.id, { promoterId: assigned.id }, admin.id);
    expect(linked).toMatchObject({ promoterId: assigned.id, promoterName: "Luis Vargas Rojas", commissionPercent: null });
    // Quitar el promotor de un código ligado lo deja sin promotor.
    const cleared = await updatePromoCode(orgId, legacy.id, { promoterId: null }, admin.id);
    expect(cleared).toMatchObject({ promoterId: null, promoterName: null });
  });
});

describe("oferta del promotor en su venta", () => {
  it("vende con su propia oferta (descuento) y no puede usar el código de otro promotor", async () => {
    const { session, orgId, admin, assigned, other } = await setup();
    const type = await prisma.ticketType.findFirstOrThrow({ where: { sessionId: session.id } });
    const mine = await createPromoCode(orgId, { code: `MIO-${unique()}`, discountType: "PERCENT", discountValue: 10, promoterId: assigned.id }, admin.id);
    const theirs = await createPromoCode(orgId, { code: `AJENO-${unique()}`, discountType: "PERCENT", discountValue: 50, promoterId: other.id }, admin.id);
    const input = (n: number) => ({ sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 2 }], buyer: buyer(n) });

    const { order } = await sellAsPromoter(input(1), { promoterId: assigned.id, provider: SIMULATED_PROVIDER, promoCode: mine.code });
    expect(order).toMatchObject({ channel: "PROMOTER", promoterId: assigned.id, discountAmount: 2_000, totalAmount: 18_000 });

    await expect(sellAsPromoter(input(2), { promoterId: assigned.id, provider: SIMULATED_PROVIDER, promoCode: theirs.code })).rejects.toThrow(/no es tuyo/);
    // Sin código sigue vendiendo al precio normal.
    const plain = await sellAsPromoter(input(3), { promoterId: assigned.id, provider: SIMULATED_PROVIDER });
    expect(plain.order).toMatchObject({ discountAmount: 0, totalAmount: 20_000 });
  });
});
