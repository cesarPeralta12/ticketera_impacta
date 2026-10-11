import type { DefaultSession } from "next-auth";
import type { StaffRole } from "@ticketera/db";

declare module "next-auth" {
  interface User {
    role: StaffRole;
    organizationId: string;
    sessionVersion: number;
  }

  interface Session {
    user: { id: string; role: StaffRole; organizationId: string; sessionVersion: number } & DefaultSession["user"];
  }
}
