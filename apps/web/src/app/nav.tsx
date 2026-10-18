import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

export async function Nav() {
  const session = await auth();
  // Las secciones del sitio. En el celular van en una segunda fila (con la cuenta no entran en una sola).
  const sections = (
    <>
      <Link href="/" className="text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]">
        Eventos
      </Link>
      <Link href="/boliches" className="font-semibold text-[#d9a6ff] transition-colors hover:text-[var(--ink)]">
        Boliches
      </Link>
      <Link href="/eventos-pequenos" className="font-semibold text-[#5fe0bd] transition-colors hover:text-[var(--ink)]">
        Eventos pequeños
      </Link>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <Link href="/" className="font-display text-xl leading-none tracking-wide text-[var(--ink)] sm:text-2xl">
          Impacta<span className="text-[var(--accent)]">.</span>
        </Link>
        <nav className="flex items-center gap-3 whitespace-nowrap text-[13px] sm:gap-5 sm:text-sm">
          <div className="hidden items-center gap-5 sm:flex">{sections}</div>
          {session?.user ? (
            <>
              <Link href="/mis-entradas" className="text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]">
                Mis entradas
              </Link>
              <Link href="/mis-eventos" className="text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]">
                Mis compras
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
                className="flex items-center gap-3"
              >
                <span className="hidden text-[var(--ink-dim)] sm:inline">{session.user.name}</span>
                <SignOutButton className="text-[var(--ink-muted)] underline decoration-[var(--border-light)] underline-offset-4 transition-colors hover:text-[var(--ink)]" />
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]">
                Ingresar
              </Link>
              <Link
                href="/registro"
                className="rounded-full bg-[var(--accent)] px-4 py-1.5 font-semibold text-[var(--accent-ink)] transition-transform hover:scale-105"
              >
                Registrarse
              </Link>
            </>
          )}
        </nav>
      </div>
      <nav aria-label="Secciones" className="flex gap-5 overflow-x-auto whitespace-nowrap px-4 pb-2.5 text-[13px] sm:hidden">
        {sections}
      </nav>
    </header>
  );
}
