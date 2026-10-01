import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyCustomerCredentials } from "@ticketera/db";

/**
 * Sesión de comprador. Cookie y secreto propios, distintos de los del panel: una sesión
 * nunca sirve en la otra app (idea del prototipo del compañero).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.WEB_AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  cookies: {
    sessionToken: {
      name: "tremor-session",
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
        return { id: customer.id, name: customer.name, email: customer.email };
      },
    }),
  ],
  callbacks: {
    session: async ({ session, token }) => {
      session.user.id = token.sub!;
      return session;
    },
  },
});
