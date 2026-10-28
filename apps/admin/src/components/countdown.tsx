"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Cuenta regresiva (mm:ss) hasta `until`. Al llegar a cero, recarga la página para mostrar el estado real. */
export function Countdown({ until }: { until: string }) {
  const router = useRouter();
  const deadline = new Date(until).getTime();
  const [left, setLeft] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    const id = setInterval(() => {
      const ms = Math.max(0, deadline - Date.now());
      setLeft(ms);
      if (ms === 0) {
        clearInterval(id);
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [deadline, router]);

  return (
    <span className="font-mono tabular-nums">
      {String(Math.floor(left / 60_000)).padStart(2, "0")}:{String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}
    </span>
  );
}
