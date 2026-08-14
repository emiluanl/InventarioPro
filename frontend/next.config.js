/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Permite un directorio de build alternativo sin pisar el .next del dev
  // server (lo usa Playwright para el build aislado de e2e):
  //   NEXT_DIST_DIR=.next-e2e next build
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Build autónomo: produce .next/standalone con un node_modules podado y un
  // server.js mínimo. El Dockerfile copia SOLO eso (sin las devDeps), lo que
  // reduce la imagen runtime de ~980MB a ~250MB. No afecta a next dev/start.
  output: 'standalone',
};

module.exports = nextConfig;
