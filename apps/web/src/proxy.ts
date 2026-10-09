import { NextResponse, type NextRequest } from "next/server";
import { isAllowedOrigin } from "@ticketera/core";

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
  const allowed = isAllowedOrigin(req.headers.get("origin"), [req.headers.get("host"), req.headers.get("x-forwarded-host"), hostOf(process.env.WEB_URL)]);
  if (!allowed) return NextResponse.json({ error: "Origen no permitido." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
