import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

export async function Nav() {
  const session = await auth();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="font-display text-2xl leading-none tracking-wide text-[var(--ink)]">
          Impacta<span className="text-[var(--accent)]">.</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/" className="text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]">
            Eventos
          </Link>
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
    </header>
  );
}
