"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ICONS, type NavIcon } from "./icons";

export type { NavIcon };

/** Enlace del menú lateral con la sección activa resaltada. */
export function NavLink({ href, label, icon, badge }: { href: string; label: string; icon: NavIcon; badge?: number }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`nav-link ${active ? "nav-link-active" : ""}`}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={ICONS[icon]} />
      </svg>
      <span className="flex-1">{label}</span>
      {badge ? <span className="rounded-full bg-[var(--warn)] px-1.5 text-[10px] font-semibold text-white">{badge}</span> : null}
    </Link>
  );
}
