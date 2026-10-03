"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

// Lector nativo de Chrome en Android (más rápido). En iPhone no existe: se usa jsQR.
type Detected = { rawValue: string };
type Detector = { detect(source: CanvasImageSource): Promise<Detected[]> };
type DetectorCtor = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

async function nativeDetector(): Promise<Detector | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    return formats.includes("qr_code") ? new Ctor({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

function cameraError(error: unknown) {
  if (!window.isSecureContext) return "La cámara solo funciona con https (o en localhost).";
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Sin permiso para usar la cámara. Habilítalo en los permisos del navegador.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") return "Este equipo no tiene cámara.";
  return "No se pudo abrir la cámara.";
}

/** Cámara trasera leyendo QR de forma continua. Llama a onRead con cada código leído. */
export function CameraScanner({ onRead }: { onRead: (raw: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onReadRef = useRef(onRead);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
      } catch (err) {
        setError(cameraError(err));
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const detector = await nativeDetector();

      const tick = async () => {
        if (stopped) return;
        if (video.readyState >= 2) {
          let value: string | null = null;
          if (detector) {
            value = (await detector.detect(video).catch(() => []))[0]?.rawValue ?? null;
          } else if (context) {
            // Cuadro reducido: jsQR es más rápido y alcanza para un QR en pantalla o papel.
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            value = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data ?? null;
          }
          if (value) onReadRef.current(value);
        }
        timer = setTimeout(tick, 180);
      };
      tick();
    }

    start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (error) return <p className="rounded-lg bg-white/10 p-4 text-sm text-amber-300">{error}</p>;
  return (
    <div className="relative overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full object-cover" />
      {/* Guía de encuadre */}
      <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/70" />
    </div>
  );
}
