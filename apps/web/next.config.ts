import type { NextConfig } from "next";

// Las variables de entorno se cargan desde el .env de la raíz vía dotenv-cli (ver package.json).
const nextConfig: NextConfig = {
  transpilePackages: ["@ticketera/core", "@ticketera/db", "@ticketera/mail"],
};

export default nextConfig;
