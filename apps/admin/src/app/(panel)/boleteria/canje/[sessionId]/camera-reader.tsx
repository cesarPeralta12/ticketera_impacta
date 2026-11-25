"use client";

import { useEffect, useRef, useState } from "react";

/** Lo mínimo de la API BarcodeDetector (Chrome en Android); TypeScript no la trae. */
type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type DetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};

const FORMATS = ["qr_code", "code_128", "code_39", "ean_13", "ean_8"];

/** La cámara trasera leyendo el QR o código de barras de la entrada. Se apaga al leer o al cerrar. */
export function CameraReader({ onRead, onClose }: { onRead: (raw: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    (async () => {
      try {
        const Class = (window as unknown as { BarcodeDetector: DetectorClass }).BarcodeDetector;
        const supported = await Class.getSupportedFormats();
        const detector = new Class({ formats: FORMATS.filter((f) => supported.includes(f)) });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const element = video.current;
        if (closed || !element) return stream.getTracks().forEach((t) => t.stop());
        element.srcObject = stream;
        await element.play();
        const look = async () => {
          if (closed) return;
          const found = await detector.detect(element).catch(() => []);
          const raw = found[0]?.rawValue;
          if (raw && !closed) {
            closed = true;
            onRead(raw);
            return;
          }
          timer = setTimeout(look, 200);
        };
        void look();
      } catch {
        if (!closed) setError("No se pudo usar la cámara. Permite el acceso en el navegador o escribe el código.");
      }
    })();

    return () => {
      closed = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onRead]);

  return (
    <div className="space-y-2">
      {error ? (
        <p role="alert" className="rounded-md bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : (
        <video ref={video} muted playsInline className="aspect-video w-full max-w-md rounded-lg bg-black object-cover" aria-label="Cámara leyendo la entrada" />
      )}
      <button type="button" className="btn" onClick={onClose}>
        Cerrar la cámara
      </button>
    </div>
  );
}
