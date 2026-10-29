import { permanentRedirect } from "next/navigation";

type Props = { searchParams: Promise<{ categoria?: string }> };

/** Los eventos pequeños se muestran en «Otros eventos»: los enlaces viejos a esta sección llevan ahí. */
export default async function SmallEventsPage({ searchParams }: Props) {
  const { categoria } = await searchParams;
  permanentRedirect(categoria ? `/otros-eventos?${new URLSearchParams({ categoria })}` : "/otros-eventos");
}
