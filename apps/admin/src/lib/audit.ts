import { recordAuditSafely, type AuditEntry } from "@ticketera/db";
import { requestContext } from "./client-ip";

/** Anota un evento con la IP y el navegador de quien hace la petición. Nunca tumba la operación si falla. */
export async function logAudit(entry: Omit<AuditEntry, "context">) {
  await recordAuditSafely({ ...entry, context: await requestContext() });
}
