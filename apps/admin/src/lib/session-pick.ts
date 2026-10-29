import { DEFAULT_TIMEZONE, zonedDateTimeToUtc } from "@ticketera/core";

/**
 * Lo que manda el selector de evento y funciones (EventSessionsPicker) y la vigencia opcional (desde/hasta, en hora de
 * Bolivia): `sessionIds` vacío es el evento completo.
 */
export function readSessionPick(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "");
  const whole = formData.get("allSessions") === "1";
  const sessionIds = whole ? undefined : formData.getAll("sessionIds").map(String).filter(Boolean);
  const date = (name: string) => {
    const value = String(formData.get(name) ?? "").trim();
    if (!value) return { ok: true as const, value: null };
    try {
      return { ok: true as const, value: zonedDateTimeToUtc(value, DEFAULT_TIMEZONE) };
    } catch {
      return { ok: false as const, field: name };
    }
  };
  const startsAt = date("startsAt");
  const endsAt = date("endsAt");
  if (!startsAt.ok || !endsAt.ok) return { ok: false as const, field: (!startsAt.ok ? startsAt : (endsAt as { field: string })).field };
  if (!whole && sessionIds && sessionIds.length === 0) return { ok: false as const, field: "sessionIds", message: "Marca al menos una función." };
  return { ok: true as const, eventId, sessionIds, startsAt: startsAt.value, endsAt: endsAt.value };
}
