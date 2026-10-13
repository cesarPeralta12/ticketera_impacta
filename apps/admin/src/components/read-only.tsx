"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Cuenta de solo lectura (organizador o cliente): los formularios del panel se muestran deshabilitados.
 * Es solo la interfaz; las server actions lo verifican por su cuenta (requireEditor).
 */
const ReadOnlyContext = createContext(false);

export function ReadOnlyProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <ReadOnlyContext.Provider value={value}>{children}</ReadOnlyContext.Provider>;
}

export const useReadOnly = () => useContext(ReadOnlyContext);
