/** Cómo se muestran en el panel los eventos del registro (AuditLog). */

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "auth.login": "Ingreso",
  "auth.login_failed": "Ingreso fallido",
  "auth.blocked": "Ingreso bloqueado (demasiados intentos)",
  "auth.logout": "Cierre de sesión",
  "auth.password_changed": "Cambio de contraseña",
  "auth.sessions_revoked": "Todas las sesiones cerradas",
  "auth.refresh_reuse": "Token reutilizado (posible robo)",
  "device.revoked": "Teléfono desconectado",
  "auth.key_shared": "Entrada abierta desde muchos aparatos (posible entrada compartida)",
  "ticket.key_issued": "Entrada de QR dinámico abierta en un celular",
  "scan.batch": "Lecturas en puerta",
  "staff.create": "Cuenta creada",
  "staff.activate": "Cuenta activada",
  "staff.deactivate": "Cuenta desactivada",
  "staff.password": "Cambio de contraseña",
};

export const actionLabel = (action: string) => AUDIT_ACTION_LABEL[action] ?? action;

/** Filtros por tipo de evento de la pantalla "Seguridad". */
export const SECURITY_FILTERS = [
  { value: "", label: "Todos los eventos" },
  { value: "auth.login", label: "Ingresos" },
  { value: "auth.login_failed", label: "Ingresos fallidos" },
  { value: "auth.blocked", label: "Bloqueos" },
  { value: "auth.password_changed", label: "Cambios de contraseña" },
  { value: "auth.sessions_revoked", label: "Sesiones cerradas" },
  { value: "device.revoked", label: "Teléfonos desconectados" },
  { value: "auth.refresh_reuse", label: "Tokens reutilizados" },
  { value: "auth.key_shared", label: "Entradas compartidas" },
  { value: "scan.batch", label: "Lecturas en puerta" },
] as const;

const REASON: Record<string, string> = {
  CREDENTIALS: "contraseña o correo incorrectos",
  BLOCKED: "demasiados intentos",
  ROLE: "cuenta de portero en el panel web",
};

/** Resumen corto del detalle de un evento, en lenguaje de persona. */
export function describeData(action: string, data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>;
  switch (action) {
    case "auth.login":
      return `${d.via === "app" ? "App de puerta" : "Navegador"}${d.newDevice ? " · dispositivo NUEVO" : ""}`;
    case "auth.login_failed":
    case "auth.blocked":
      return `${typeof d.email === "string" ? d.email : ""}${typeof d.reason === "string" ? ` · ${REASON[d.reason] ?? d.reason}` : ""}`.trim();
    case "auth.sessions_revoked":
      return d.by === "admin" ? `cerradas por un administrador (${d.devices ?? 0} teléfono(s))` : "";
    case "device.revoked":
      return typeof d.deviceName === "string" ? d.deviceName : "";
    case "auth.refresh_reuse":
      return `${typeof d.deviceName === "string" ? `${d.deviceName} · ` : ""}la sesión del teléfono se cerró`;
    case "auth.key_shared":
      return `entrada ${typeof d.code === "string" ? d.code : ""} abierta desde ${d.devices ?? "varios"} aparatos distintos en 24 h`;
    case "ticket.key_issued":
      return typeof d.code === "string" ? `entrada ${d.code}` : "";
    case "scan.batch":
      return `${d.total ?? 0} lectura(s): ${d.accepted ?? 0} entraron, ${d.rejected ?? 0} rechazadas${d.expired ? `, ${d.expired} QR vencidos` : ""}${d.offline ? `, ${d.offline} sin conexión` : ""}${d.BAD_PROOF ? ` · ${d.BAD_PROOF} con prueba SOSPECHOSA` : ""}`;
    default: {
      const text = data ? JSON.stringify(data) : "";
      return text.length > 140 ? `${text.slice(0, 140)}…` : text;
    }
  }
}
