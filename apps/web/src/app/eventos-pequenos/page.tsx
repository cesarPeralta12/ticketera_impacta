import { permanentRedirect } from "next/navigation";

type Props = { searchParams: Promise<{ categoria?: string }> };

/** Los eventos pequeños ahora son un filtro de Eventos: los enlaces viejos a esta sección llevan ahí. */
export default async function SmallEventsPage({ searchParams }: Props) {
  const { categoria } = await searchParams;
  const qs = new URLSearchParams({ ...(categoria ? { categoria } : {}), pequenos: "1" });
  permanentRedirect(`/?${qs}`);
}
