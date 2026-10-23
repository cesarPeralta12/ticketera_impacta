import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import "./globals.css";
import { Nav } from "./nav";

// Poppins en todo el sitio (guía visual iPass): Bold títulos, SemiBold secciones, Medium botones, Regular texto.
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: { default: "iPass — Entradas para eventos en Bolivia", template: "%s · iPass" },
  description: "Compra entradas para conciertos, teatro, festivales y más en Bolivia.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${poppins.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Nav />
        {children}
        <footer className="mt-auto border-t border-[var(--border)] px-6 py-8 text-xs text-[var(--ink-dim)]">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Logo className="h-6 w-auto" />
            <span>© 2026 · Entradas para eventos en Bolivia</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
