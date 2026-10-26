import type { ReactNode } from "react";
import { formatClock, formatMoney } from "@ticketera/core";
import type { ClubOffer } from "@/lib/nightlife";

/** Lo que ofrece una noche de boliche: en fichas (tarjeta) o en detalle (página del boliche). */
export function ClubOfferView({
  offer,
  currency,
  timeZone,
  detailed = false,
}: {
  offer: ClubOffer;
  currency: string;
  timeZone: string;
  detailed?: boolean;
}) {
  const money = (amount: number) => formatMoney(amount, currency);
  const items: { key: string; title: string; text: string; tone: string }[] = [];
  if (offer.free) {
    items.push({
      key: "free",
      title: `Free hasta las ${formatClock(offer.free.until, timeZone)}`,
      text: `${offer.free.name}: gratis con tu cuenta, una por persona. Después de esa hora ya no entra.`,
      tone: "#35C48F",
    });
  }
  for (const t of offer.tables) {
    items.push({
      key: `mesa-${t.name}`,
      title: `${t.name} · ${money(t.price)}`,
      text: `${t.people} personas, cada una con su QR${t.consumption ? ` · incluye ${money(t.consumption)} de consumo` : ""}${t.left > 0 && t.left <= 5 ? ` · ¡quedan ${t.left}!` : t.left === 0 ? " · agotadas" : ""}`,
      tone: "#AD468D",
    });
  }
  for (const d of offer.drinks) {
    items.push({
      key: `trago-${d.name}`,
      title: `${d.name} · ${money(d.price)}`,
      text: `Incluye ${money(d.consumption)} para canjear en la barra.`,
      tone: "#F5B700",
    });
  }

  if (!detailed) {
    return (
      <ul className="flex flex-wrap gap-1.5">
        {offer.free && <Chip tone="#35C48F">Free hasta {formatClock(offer.free.until, timeZone)}</Chip>}
        {offer.tables[0] && (
          <Chip tone="#AD468D">
            Mesas desde {money(offer.tables[0].price)}
            {offer.tables[0].consumption ? " con consumo" : ""}
          </Chip>
        )}
        {offer.drinks[0] && <Chip tone="#F5B700">Entrada + trago {money(offer.drinks[0].price)}</Chip>}
        {offer.entryFrom !== null && <Chip tone="#9BA9C4">Entrada desde {money(offer.entryFrom)}</Chip>}
      </ul>
    );
  }
  if (items.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.key} className="rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] p-4" style={{ borderLeft: `3px solid ${item.tone}` }}>
          <p className="font-semibold">{item.title}</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{item.text}</p>
        </li>
      ))}
    </ul>
  );
}

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <li className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide" style={{ background: `${tone}22`, color: tone }}>
      {children}
    </li>
  );
}
