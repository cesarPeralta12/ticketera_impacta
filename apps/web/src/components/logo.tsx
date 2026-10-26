/** Logo iPass: en blanco ("negativo") sobre el fondo azul noche del sitio; a color sobre fondos claros. */
export function Logo({ negative = true, className = "h-8 w-auto" }: { negative?: boolean; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG del logo, no necesita optimizar
    <img src={negative ? "/ipass-logo-blanco.svg" : "/ipass-logo.svg"} alt="iPass" width={2154} height={884} className={className} />
  );
}
