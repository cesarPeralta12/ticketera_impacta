import type { ReactNode } from "react";
import { requireFullView } from "@/lib/session";

/** Pantalla de detalle: el dueño de un organizador de solo lectura no la ve (ver `limitedView`). */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireFullView();
  return children;
}
