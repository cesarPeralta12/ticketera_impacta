import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cache } from "react";
import { prisma, verifyCustomerCredentials } from "@ticketera/db";

/**
 * Sesión de comprador. Cookie y secreto propios, distintos de los del panel: una sesión
 * nunca sirve en la otra app (idea del prototipo del compañero).
 */
export const { handlers, auth: authSession, signIn, signOut } = NextAuth({
  secret: process.env.WEB_AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  cookies: {
    sessionToken: {
      name: "impacta-session",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (credentials) => {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) throw new CredentialsSignin();
        const customer = await verifyCustomerCredentials(email, password);
        if (!customer) throw new CredentialsSignin();
        return { id: customer.id, name: customer.name, email: customer.email, sessionVersion: customer.sessionVersion };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) token.sv = (user as { sessionVersion?: number }).sessionVersion ?? 0;
      return token;
    },
    session: async ({ session, token }) => {
      session.user.id = token.sub!;
      session.user.sessionVersion = (token.sv as number | undefined) ?? 0;
      return session;
    },
  },
});

/**
 * Sesión del comprador, verificada contra la cuenta. El JWT por sí solo no se puede revocar; esta consulta
 * sí: si el comprador cambió su contraseña o cerró todas las sesiones, o la cuenta ya no existe, la sesión
 * vieja deja de valer en la siguiente petición. Una consulta por petición (cache de React).
 */
export const auth = cache(async () => {
  const session = await authSession();
  if (!session?.user?.id) return null;
  const customer = await prisma.customer.findUnique({ where: { id: session.user.id }, select: { sessionVersion: true } });
  if (!customer || customer.sessionVersion !== session.user.sessionVersion) return null;
  return session;
});
