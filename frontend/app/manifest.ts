// =============================================================================
// app/manifest.ts - manifest de la PWA (soporte nativo de Next.js App Router)
// =============================================================================
// Next.js lo sirve en /manifest.json e inyecta el <link rel="manifest">
// automáticamente. Habilita la instalación en home screen (display standalone)
// y define iconos y colores de la marca.
// =============================================================================

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'InventarioPro',
    short_name: 'InventarioPro',
    description: 'Registra tus productos, garantías y gastos.',
    start_url: '/',
    display: 'standalone',
    // Fondo de marca: el tema predeterminado de la app es oscuro (#0a0a0b).
    background_color: '#0a0a0b',
    theme_color: '#0a84ff',
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
