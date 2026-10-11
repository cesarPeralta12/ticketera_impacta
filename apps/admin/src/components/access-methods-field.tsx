import { ACCESS_METHOD_LABEL } from "@/lib/labels";

const METHODS = ["QR", "BARCODE", "NFC"] as const;

/** Casillas para elegir cómo se lee una entrada en puerta. Se envían como `methods`. */
export function AccessMethodsField({ defaultValue = ["QR"] }: { defaultValue?: readonly string[] }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <legend className="sr-only">Cómo se lee en puerta</legend>
      {METHODS.map((m) => (
        <label key={m} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="methods" value={m} defaultChecked={defaultValue.includes(m)} className="accent-[var(--accent)]" />
          {ACCESS_METHOD_LABEL[m]}
        </label>
      ))}
    </fieldset>
  );
}
