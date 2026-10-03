import type { NextConfig } from "next";

// Las variables de entorno se cargan desde el .env de la raíz vía dotenv-cli (ver package.json).
const nextConfig: NextConfig = {
  transpilePackages: ["@ticketera/core", "@ticketera/db"],
  async headers() {
    return [
      {
        // Service worker de la app de puerta: siempre la versión nueva, solo scripts propios.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
