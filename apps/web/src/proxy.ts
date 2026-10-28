import { NextResponse, type NextRequest } from "next/server";
import { isAllowedOrigin, isValidPromoCode, normalizePromoCode } from "@ticketera/core";
import { PROMO_COOKIE, PROMO_COOKIE_MAX_AGE } from "@/lib/promo-cookie";

const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
};

/**
 * Las APIs del sitio (fila virtual, sesión) solo aceptan peticiones de este mismo sitio: una página ajena
 * no puede hacerlas con la sesión del comprador. Sin `Origin` (navegación normal, herramientas) no hay nada
 * que comparar; las acciones de formulario ya las valida Next contra el host.
 */
export default function proxy(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/")) return rememberPromo(req);
  const allowed = isAllowedOrigin(req.headers.get("origin"), [req.headers.get("host"), req.headers.get("x-forwarded-host"), hostOf(process.env.WEB_URL)]);
  if (!allowed) return NextResponse.json({ error: "Origen no permitido." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  return NextResponse.next();
}

/** Enlace de un promotor (`?promo=`): se guarda su código para aplicarlo solo al comprar (ver lib/promo-cookie). */
function rememberPromo(req: NextRequest) {
  const response = NextResponse.next();
  const code = normalizePromoCode(req.nextUrl.searchParams.get("promo") ?? "");
  if (isValidPromoCode(code)) {
    response.cookies.set(PROMO_COOKIE, code, { maxAge: PROMO_COOKIE_MAX_AGE, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  }
  return response;
}

export const config = { matcher: ["/api/:path*", "/eventos/:path*", "/comprar/:path*"] };
