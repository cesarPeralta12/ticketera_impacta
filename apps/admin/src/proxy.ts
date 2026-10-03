import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./lib/auth.config";

const { auth } = NextAuth(authConfig);

/** Secciones a las que puede entrar cada rol restringido (el resto, a su pantalla de inicio). */
const RESTRICTED: Record<string, { home: string; allowed: string[] }> = {
  OPERATOR: { home: "/puerta", allowed: ["/puerta", "/api/puerta"] },
  CASHIER: { home: "/boleteria", allowed: ["/boleteria"] },
  CLIENT: { home: "/cliente", allowed: ["/cliente"] },
};

/**
 * Primera barrera del panel: sin sesión, al login; cada rol restringido solo ve su parte
 * (puerta, boletería o espacio del cliente). Es una redirección de cortesía: la
 * autorización real la hace requireStaff() en cada página y server action.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/health" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    /^\/icon[\w-]*\.(svg|png)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const user = req.auth?.user;
  if (!user) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
    const login = new URL("/login", req.nextUrl);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  const rule = RESTRICTED[user.role];
  if (rule && !rule.allowed.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.redirect(new URL(rule.home, req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
