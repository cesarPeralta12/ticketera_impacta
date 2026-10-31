import { describe, expect, it } from "vitest";
import { canAdministerOrganization, isReadOnlyAccount } from "./permissions";

const base = { platform: false, preview: false, selfManaged: false };

describe("permisos de las cuentas del panel", () => {
  it("iPass edita siempre, también dentro de un organizador", () => {
    expect(isReadOnlyAccount({ ...base, platform: true, role: "OWNER" })).toBe(false);
    expect(canAdministerOrganization({ ...base, platform: true, role: "ADMIN" })).toBe(true);
  });

  it("el dueño y el administrador de un organizador son de solo lectura por defecto", () => {
    for (const role of ["OWNER", "ADMIN"]) {
      expect(isReadOnlyAccount({ ...base, role })).toBe(true);
      expect(canAdministerOrganization({ ...base, role })).toBe(false);
    }
  });

  it("con administración propia editan lo suyo y administran a su personal", () => {
    for (const role of ["OWNER", "ADMIN"]) {
      expect(isReadOnlyAccount({ ...base, role, selfManaged: true })).toBe(false);
      expect(canAdministerOrganization({ ...base, role, selfManaged: true })).toBe(true);
    }
  });

  it("el cliente (productora) es siempre de solo lectura, aunque el organizador administre", () => {
    expect(isReadOnlyAccount({ ...base, role: "CLIENT", selfManaged: true })).toBe(true);
    expect(canAdministerOrganization({ ...base, role: "CLIENT", selfManaged: true })).toBe(false);
  });

  it("el personal de operación no pasa a administrar por la administración propia", () => {
    for (const role of ["OPERATOR", "CASHIER", "PROMOTER", "BAR"]) {
      expect(canAdministerOrganization({ ...base, role, selfManaged: true })).toBe(false);
      expect(isReadOnlyAccount({ ...base, role, selfManaged: true })).toBe(false); // su trabajo no cambia
    }
  });

  it("la vista previa de iPass es siempre de solo lectura y sin administración", () => {
    expect(isReadOnlyAccount({ ...base, preview: true, role: "ADMIN", selfManaged: true })).toBe(true);
    expect(canAdministerOrganization({ ...base, platform: true, preview: true, role: "ADMIN" })).toBe(false);
  });
});
