"use client";

import { useState } from "react";

export type AccountOrg = { id: string; name: string; platform: boolean; nightlife: boolean };
export type AccountClient = { id: string; name: string };

const LABEL = {
  OPERATOR: "Operador de puerta",
  CASHIER: "Cajero (boletería y barra)",
  PROMOTER: "Promotor (vende con QR)",
  BAR: "Barra (lee QR de consumo)",
  CLIENT: "Cliente (solo lectura)",
  ADMIN: "Administrador",
  OWNER: "Dueño",
} as const;

type Role = keyof typeof LABEL;

/**
 * Organización y rol de una cuenta nueva. iPass elige a qué organizador (o a iPass) pertenece; los roles que se pueden
 * dar dependen de ahí: en un organizador hay administrador, personal y promotores; en iPass, además, dueños y clientes.
 * Un organizador con administración propia crea siempre en el suyo y solo a su personal.
 */
export function AccountFields({
  orgs,
  defaultOrgId,
  chooseOrg,
  canMakeAdmins,
  canMakeOwners,
  clients,
}: {
  orgs: AccountOrg[];
  defaultOrgId: string;
  /** Solo iPass elige la organización. */
  chooseOrg: boolean;
  /** iPass puede dar administradores; un organizador, no. */
  canMakeAdmins: boolean;
  canMakeOwners: boolean;
  clients: AccountClient[];
}) {
  const [orgId, setOrgId] = useState(defaultOrgId);
  const org = orgs.find((o) => o.id === orgId) ?? orgs[0]!;
  const roles: Role[] = [
    "OPERATOR",
    "CASHIER",
    "BAR",
    "PROMOTER",
    ...(org.platform ? (["CLIENT"] as Role[]) : []),
    ...(canMakeAdmins ? (["ADMIN"] as Role[]) : []),
    ...(org.platform && canMakeOwners ? (["OWNER"] as Role[]) : []),
  ];
  const [role, setRole] = useState<Role>("OPERATOR");
  const effectiveRole = roles.includes(role) ? role : "OPERATOR";

  return (
    <>
      {chooseOrg && (
        <label className="label">
          Para
          <select name="organizationId" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="field min-w-52">
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.platform ? "iPass (cuentas propias)" : `${o.name}${o.nightlife ? " · boliche" : ""}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="label">
        Rol
        <select name="role" value={effectiveRole} onChange={(e) => setRole(e.target.value as Role)} className="field">
          {roles.map((r) => (
            <option key={r} value={r}>
              {r === "ADMIN" && !org.platform ? "Administrador del organizador" : LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      {org.platform && effectiveRole === "CLIENT" && (
        <label className="label">
          Cliente
          <select name="clientId" defaultValue="" className="field">
            <option value="">—</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
