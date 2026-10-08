import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ROLES, can, requireStaff } from "@/lib/session";
import { DoorSignOut, RegisterServiceWorker } from "./door-chrome";

export const metadata: Metadata = {
  title: { default: "Puerta", template: "%s · Puerta Impacta" },
  appleWebApp: { capable: true, title: "Puerta", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#14181b" };

/** App de puerta: pantalla oscura y botones grandes, pensada para el celular del operador. */
export default async function DoorLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff(ROLES.access);
  if (staff.mustChangePassword) redirect("/cuenta/contrasena");
  return (
    <div className="min-h-dvh bg-[#14181b] text-white">
      <RegisterServiceWorker />
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <Link href="/puerta" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- ícono local de 28 px */}
          <img src="/icon.svg" alt="" width={28} height={28} className="rounded-md" />
          <span className="leading-tight">
            <span className="block text-sm font-semibold">{staff.organization.name} · Puerta</span>
            <span className="block text-xs text-white/50">{staff.name}</span>
          </span>
        </Link>
        <span className="ml-auto flex items-center gap-2">
          {can(staff, ROLES.manage) && (
            <Link href="/" className="rounded-md bg-white/10 px-3 py-1.5 text-xs">
              Panel
            </Link>
          )}
          <DoorSignOut />
        </span>
      </header>
      <main className="mx-auto w-full max-w-xl p-4">{children}</main>
    </div>
  );
}
