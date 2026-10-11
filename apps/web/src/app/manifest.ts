import type { MetadataRoute } from "next";

/** Para poder instalar el sitio en la pantalla de inicio: las entradas abren como una app, también sin internet. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Impacta — Mis entradas",
    short_name: "Impacta",
    description: "Tus entradas, listas para usar sin internet.",
    start_url: "/mis-entradas",
    scope: "/",
    display: "standalone",
    background_color: "#14181b",
    theme_color: "#14181b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
