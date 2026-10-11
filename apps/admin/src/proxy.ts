import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { isAllowedOrigin } from "@ticketera/core";
import { authConfig } from "./lib/auth.config";

const { auth } = NextAuth(authConfig);

/** Secciones a las que puede entrar cada rol restringido (el resto, a su pantalla de inicio). */
const RESTRICTED: Record<string, { home: string; allowed: string[] }> = {
  CASHIER: { home: "/boleteria", allowed: ["/boleteria", "/cuenta"] },
  CLIENT: { home: "/cliente", allowed: ["/cliente", "/cuenta"] },
};

/**
 * Primera barrera del panel: sin sesión, al login; cada rol restringido solo ve su parte
 * (boletería o espacio del cliente). Es una redirección de cortesía: la
 * autorización real la hace requireStaff() en cada página y server action.
 */
const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
};

/**
 * Las APIs no hablan con páginas de otros sitios: /api/v1 es solo para la app móvil (no manda `Origin`, los
 * navegadores sí) y el resto solo acepta su propio origen. Sin cabeceras CORS, un navegador tampoco deja
 * leer las respuestas desde otro sitio; esto además corta la petición antes de que llegue a la ruta.
 */
function blockedApiOrigin(req: Parameters<Parameters<typeof auth>[0]>[0]) {
  const origin = req.headers.get("origin");
  if (req.nextUrl.pathname.startsWith("/api/v1/")) {
    return origin !== null || req.headers.get("sec-fetch-site") === "cross-site";
  }
  return !isAllowedOrigin(origin, [req.headers.get("host"), req.headers.get("x-forwarded-host"), hostOf(process.env.ADMIN_URL)]);
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/") && blockedApiOrigin(req)) {
    return NextResponse.json({ error: "Origen no permitido." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (
    pathname.startsWith("/login") ||
    // Recuperar la contraseña se hace sin sesión (por eso mismo se olvidó).
    pathname.startsWith("/olvide-contrasena") ||
    pathname.startsWith("/restablecer") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/health" ||
    // La app móvil de puerta usa tokens propios (Authorization: Bearer), no la cookie del panel.
    pathname.startsWith("/api/v1/") ||
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
