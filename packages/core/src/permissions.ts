/**
 * Quién puede cambiar cosas en el panel. iPass siempre. Las cuentas de un organizador o de un boliche (dueño y
 * administrador) son de solo lectura, salvo que iPass le haya dado «administración propia» a ese organizador
 * (`selfManaged`): entonces crean y editan lo suyo, y lo que publican pasa por aprobación de iPass. El cliente (la
 * productora de un evento) es siempre de solo lectura. El personal de operación (cajero, portero, barra, promotor)
 * no depende de esto: sigue vendiendo, cobrando y leyendo QR.
 */
export type AccountAccess = {
  /** Administrador de iPass trabajando como tal (no en vista previa). */
  platform: boolean;
  /** iPass mirando el panel como lo ve una cuenta del organizador. */
  preview: boolean;
  role: string;
  /** El organizador de la cuenta tiene administración propia. */
  selfManaged: boolean;
};

const MANAGER_ROLES = ["OWNER", "ADMIN"];

/** ¿La cuenta ve todo lo suyo pero no puede cambiar nada? */
export function isReadOnlyAccount({ platform, preview, role, selfManaged }: AccountAccess): boolean {
  if (preview) return true;
  if (platform) return false;
  if (role === "CLIENT") return true;
  return MANAGER_ROLES.includes(role) && !selfManaged;
}

/** ¿Puede administrar (editar lo del organizador y crear las cuentas de su personal)? iPass, o un organizador con administración propia. */
export function canAdministerOrganization({ platform, preview, role, selfManaged }: AccountAccess): boolean {
  if (preview) return false;
  if (platform) return true;
  return MANAGER_ROLES.includes(role) && selfManaged;
}
