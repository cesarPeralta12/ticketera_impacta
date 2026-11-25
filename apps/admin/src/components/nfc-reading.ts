"use client";

/**
 * Leer tarjetas y manillas NFC desde el panel: con el NFC del teléfono (Web NFC, Chrome en Android) o con un lector USB
 * que funciona como teclado. Lo usan el canje y la carga masiva.
 */
import { useSyncExternalStore } from "react";
import type { ReaderByteOrder } from "@ticketera/core";

/** Lo mínimo que se usa de Web NFC; TypeScript no lo trae. */
export type WebNfcReader = {
  scan(options: { signal: AbortSignal }): Promise<void>;
  onreading: ((event: { serialNumber: string }) => void) | null;
  onreadingerror: (() => void) | null;
};
export type WebNfcWindow = Window & { NDEFReader?: new () => WebNfcReader };

// Lo que sabe hacer este aparato: en el servidor, nada; en el navegador se pregunta una vez.
const never = () => () => {};
export const useBrowserHas = (name: "NDEFReader" | "BarcodeDetector") => useSyncExternalStore(never, () => name in window, () => false);

const ORDER_KEY = "ipass-lector-usb-orden";
const orderListeners = new Set<() => void>();
const readOrder = (): ReaderByteOrder => {
  try {
    return localStorage.getItem(ORDER_KEY) === "REVERSED" ? "REVERSED" : "NORMAL";
  } catch {
    return "NORMAL";
  }
};
const subscribeOrder = (listener: () => void) => {
  orderListeners.add(listener);
  return () => void orderListeners.delete(listener);
};

/** El orden de los bytes del lector USB de esta computadora (se recuerda en el navegador). */
export function useReaderOrder() {
  const order = useSyncExternalStore(subscribeOrder, readOrder, () => "NORMAL" as const);
  const change = (value: ReaderByteOrder) => {
    try {
      localStorage.setItem(ORDER_KEY, value);
    } catch {
      // Sin almacenamiento (modo privado): queda como estaba.
    }
    orderListeners.forEach((listener) => listener());
  };
  return [order, change] as const;
}

export { formatUid } from "@/lib/format-uid";

/** En un teléfono, poner el cursor solo abriría el teclado encima de la pantalla: se hace con mouse (lectores USB). */
export const focusForReader = (input: HTMLInputElement | null) => {
  if (!window.matchMedia("(pointer: coarse)").matches) input?.focus();
};
