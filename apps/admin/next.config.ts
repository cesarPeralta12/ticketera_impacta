import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Política de contenido: el navegador solo ejecuta scripts y estilos de este mismo sitio. Las imágenes
 * pueden venir de cualquier https (portadas de eventos). `'unsafe-inline'` es necesario porque Next
 * incrusta scripts de hidratación sin nonce; `'unsafe-eval'` solo en desarrollo (recarga en caliente).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isProd ? "" : " ws: wss:"}`,
  "frame-ancestors 'none'", // nadie puede meter este sitio en un iframe (clickjacking)
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

// Las variables de entorno se cargan desde el .env de la raíz vía dotenv-cli (ver package.json).
const nextConfig: NextConfig = {
  transpilePackages: ["@ticketera/core", "@ticketera/db", "@ticketera/mail"],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
