"use client";

import { useEffect, useRef, useState } from "react";

const DURATION_MS = 700;

/**
 * Número del resumen que sube hasta su valor (al cargar, desde 0; al actualizarse, desde el anterior).
 * El servidor ya lo escribe completo: sin JavaScript o con "menos movimiento" se ve el número quieto.
 */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    // Con "menos movimiento" llega de una vez (en el primer cuadro).
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : DURATION_MS;
    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{shown.toLocaleString("es-BO")}</>;
}
