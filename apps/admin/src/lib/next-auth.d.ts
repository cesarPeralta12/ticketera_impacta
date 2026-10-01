import type { DefaultSession } from "next-auth";
import type { StaffRole } from "@ticketera/db";

declare module "next-auth" {
  interface User {
    role: StaffRole;
    organizationId: string;
  }

  interface Session {
    user: { id: string; role: StaffRole; organizationId: string } & DefaultSession["user"];
  }
}
