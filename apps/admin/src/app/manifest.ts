import type { MetadataRoute } from "next";

/** La app de puerta se instala en el celular del operador como una app más (PWA). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Impacta Puerta",
    short_name: "Puerta",
    description: "Control de acceso de Impacta: lee QR y NFC, y sigue funcionando sin internet.",
    start_url: "/puerta",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#14181b",
    theme_color: "#14181b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
