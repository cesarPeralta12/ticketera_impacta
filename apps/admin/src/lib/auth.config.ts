import type { NextAuthConfig } from "next-auth";
import type { StaffRole } from "@ticketera/db";

/**
 * Configuración de sesión del panel. Sin acceso a la base de datos: la usa también el
 * proxy, que corre antes de cada request.
 *
 * Cookie y secreto propios: en localhost las dos apps comparten dominio, así que con
 * nombres distintos sus sesiones quedan completamente separadas (idea del prototipo).
 */
export const authConfig = {
  secret: process.env.ADMIN_AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // una jornada de trabajo
  pages: { signIn: "/login" },
  providers: [],
  cookies: {
    sessionToken: {
      name: "impacta-admin-session",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    },
  },
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = user.role;
        token.organizationId = user.organizationId;
        token.sv = user.sessionVersion;
      }
      return token;
    },
    session: async ({ session, token }) => {
      session.user.id = token.sub!;
      // El JWT de NextAuth v5 no toma la extensión de tipos: se tipan aquí.
      session.user.role = token.role as StaffRole;
      session.user.organizationId = token.organizationId as string;
      // Versión de sesión con la que se inició: si la cuenta la subió (cambio de clave, "cerrar sesiones"), ya no vale.
      session.user.sessionVersion = (token.sv as number | undefined) ?? 0;
      return session;
    },
  },
} satisfies NextAuthConfig;
