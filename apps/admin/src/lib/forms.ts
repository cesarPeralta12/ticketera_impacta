import { z } from "zod";

/** Resultado estándar de las server actions de formularios del panel. */
export type FormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean } | undefined;

/** Convierte los errores de zod en un mensaje por campo (el primero de cada uno). */
export function zodErrors(error: z.ZodError): FormState {
  const fieldErrors: Record<string, string> = {};
  let general: string | undefined;
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key) fieldErrors[key] ??= issue.message;
    else general ??= issue.message;
  }
  return { error: general ?? "Revisa los campos marcados.", fieldErrors };
}

/** Lee un FormData como objeto plano (los campos vacíos quedan como undefined). */
export function formObject(formData: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value.trim() === "" ? undefined : value.trim();
  }
  return out;
}

/** "120", "120.5" o "120,50" bolivianos -> 12050 centavos. */
export const moneyField = z
  .string({ error: "Ingresa un precio." })
  .regex(/^\d{1,7}([.,]\d{1,2})?$/, "Precio inválido (ej. 120 o 120,50).")
  .transform((v) => Math.round(Number(v.replace(",", ".")) * 100));

export const intField = (min: number, max: number, label: string) =>
  z.coerce
    .number({ error: `Ingresa ${label}.` })
    .int(`${label} debe ser un número entero.`)
    .min(min, `${label} debe ser al menos ${min}.`)
    .max(max, `${label} debe ser como máximo ${max}.`);
