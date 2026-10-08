import { describe, expect, it } from "vitest";
import {
  MAX_TRANSFERS_PER_TICKET,
  TRANSFER_CUTOFF_HOURS,
  TRANSFER_OFFER_HOURS,
  offerExpiry,
  transferBlockReason,
  type TransferCheck,
} from "./transfers";

const now = new Date("2026-10-10T12:00:00Z");
const base: TransferCheck = {
  status: "VALID",
  transferCount: 0,
  startsAt: new Date("2026-11-01T20:00:00Z"),
  eventTransfersEnabled: true,
  sessionCancelled: false,
  hasPendingTransfer: false,
  now,
};

describe("reglas de transferencia", () => {
  it("una entrada válida, con tiempo y sin transferir se puede ofrecer", () => {
    expect(transferBlockReason(base)).toBeNull();
  });

  it.each([
    [{ status: "USED" as const }, /ya se usó/],
    [{ status: "CANCELLED" as const }, /anulada/],
    [{ sessionCancelled: true }, /cancelada/],
    [{ eventTransfersEnabled: false }, /no permite/],
    [{ hasPendingTransfer: true }, /Ya la ofreciste/],
    [{ transferCount: MAX_TRANSFERS_PER_TICKET }, /no se puede transferir más/],
  ])("se bloquea cuando %j", (patch, message) => {
    expect(transferBlockReason({ ...base, ...patch })).toMatch(message);
  });

  it("deja de poder transferirse en las últimas horas antes de la función", () => {
    const starts = new Date(now.getTime() + (TRANSFER_CUTOFF_HOURS * 60 - 1) * 60_000);
    expect(transferBlockReason({ ...base, startsAt: starts })).toMatch(/menos de/);
    const later = new Date(now.getTime() + (TRANSFER_CUTOFF_HOURS * 60 + 1) * 60_000);
    expect(transferBlockReason({ ...base, startsAt: later })).toBeNull();
  });

  it("la oferta vence a las 72 h, o antes si la función está por empezar", () => {
    expect(offerExpiry(now, base.startsAt).getTime()).toBe(now.getTime() + TRANSFER_OFFER_HOURS * 3_600_000);
    const soon = new Date(now.getTime() + 10 * 3_600_000);
    expect(offerExpiry(now, soon).getTime()).toBe(soon.getTime() - TRANSFER_CUTOFF_HOURS * 3_600_000);
  });
});
