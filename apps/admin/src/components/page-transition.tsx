"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Cada página del panel entra con un fundido suave (se repite al cambiar de sección, no al refrescar). */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
