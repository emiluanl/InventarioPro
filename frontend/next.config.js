/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // serverActions están estables en Next 14, pero dejamos la puerta abierta.
  },
};

module.exports = nextConfig;
