"use client";

import { useState } from "react";

/**
 * Imagen del evento. <img> y no next/image porque el organizador puede pegar la URL de
 * cualquier sitio. Si no carga, se muestra la inicial del evento en vez del ícono roto.
 */
export function EventImage({
  src,
  title,
  className,
  eager = false,
}: {
  src: string | null;
  title: string;
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--bg-raised-2)] font-display text-5xl text-[var(--ink-dim)]">
        {title.slice(0, 1)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading={eager ? "eager" : "lazy"} onError={() => setFailed(true)} className={className} />
  );
}
