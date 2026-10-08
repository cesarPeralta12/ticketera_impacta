import { getDoorAssignments } from "@ticketera/db";
import { json, mobileStaff } from "@/lib/mobile-auth";

/** Funciones (con sus puertas y métodos de lectura) que este usuario puede controlar. */
export async function GET(req: Request) {
  const staff = await mobileStaff(req);
  if (!staff) return json({ error: "Sesión vencida." }, 401);
  return json({ staff: { name: staff.name, role: staff.role }, sessions: await getDoorAssignments(staff) });
}
