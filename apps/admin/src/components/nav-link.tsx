"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Íconos del menú (trazo simple, 24×24). */
const ICONS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  calendar: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  briefcase: "M9 6V4h6v2M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM3 13h18",
  map: "M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  ticket: "M3 9V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a3 3 0 0 0 0 6v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a3 3 0 0 0 0-6zM14 5v14",
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01",
  check: "M20 6 9 17l-5-5M4 21h16",
  door: "M5 21V4a1 1 0 0 1 1-1h8l5 3v15M5 21h14M13 12h.01M9 21V8",
  users: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8",
} as const;

export type NavIcon = keyof typeof ICONS;

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
