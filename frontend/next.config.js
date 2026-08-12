/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Permite un directorio de build alternativo sin pisar el .next del dev
  // server (lo usa Playwright para el build aislado de e2e):
  //   NEXT_DIST_DIR=.next-e2e next build
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

module.exports = nextConfig;
