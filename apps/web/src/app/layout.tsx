import type { Metadata } from "next";
import { Anton, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import { Nav } from "./nav";

const anton = Anton({ variable: "--font-anton", subsets: ["latin"], weight: "400" });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Impacta — Entradas para eventos en Bolivia", template: "%s · Impacta" },
  description: "Compra entradas para conciertos, teatro, festivales y más en Bolivia.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${anton.variable} ${manrope.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Nav />
        {children}
        <footer className="mt-auto border-t border-[var(--border)] px-6 py-8 text-xs text-[var(--ink-dim)]">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-display text-sm tracking-wide text-[var(--ink-muted)]">Impacta</span>
            <span>© 2026 · Entradas para eventos en Bolivia</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
