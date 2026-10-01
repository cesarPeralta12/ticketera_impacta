import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./lib/auth.config";

const { auth } = NextAuth(authConfig);

/**
 * Primera barrera del panel: sin sesión, al login; un operador de puerta solo ve el
 * control de acceso. Es una redirección de cortesía: la autorización real la hace
 * requireStaff() en cada página y server action.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth") || pathname === "/api/health") {
    return NextResponse.next();
  }

  const user = req.auth?.user;
  if (!user) {
    const login = new URL("/login", req.nextUrl);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  if (user.role === "OPERATOR" && !pathname.startsWith("/acceso")) {
    return NextResponse.redirect(new URL("/acceso", req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
