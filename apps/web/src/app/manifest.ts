import type { MetadataRoute } from "next";

/** Para poder instalar el sitio en la pantalla de inicio: las entradas abren como una app, también sin internet. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "iPass — Mis entradas",
    short_name: "iPass",
    description: "Tus entradas, listas para usar sin internet.",
    start_url: "/mis-entradas",
    scope: "/",
    display: "standalone",
    background_color: "#111a2b",
    theme_color: "#192438",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
