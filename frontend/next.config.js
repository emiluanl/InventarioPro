/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Permite un directorio de build alternativo (p. ej. para builds de prueba
  // sin pisar el .next del dev server): NEXT_DIST_DIR=.next-pwa next build
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    // serverActions están estables en Next 14, pero dejamos la puerta abierta.
  },
};

module.exports = nextConfig;
