import type { JSX } from 'react';

import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';

export const metadata: Metadata = {
  title: 'InventarioPro',
  description: 'Registra tus productos, garantías y gastos.',
  icons: {
    icon: [
      { url: '/icons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'InventarioPro',
    statusBarStyle: 'default',
    // Splash screen de arranque para la app instalada en iOS (apple-touch-startup-image).
    // El media query de cada imagen identifica el dispositivo por resolución CSS + DPR.
    startupImage: [
      {
        url: '/icons/splash-640x1136.png',
        media: '(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)',
      },
      {
        url: '/icons/splash-750x1334.png',
        media: '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)',
      },
      {
        url: '/icons/splash-1125x2436.png',
        media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)',
      },
      {
        url: '/icons/splash-1242x2688.png',
        media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)',
      },
      {
        url: '/icons/splash-1170x2532.png',
        media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)',
      },
      {
        url: '/icons/splash-2532x1170.png',
        media: '(device-width: 844px) and (device-height: 390px) and (-webkit-device-pixel-ratio: 3)',
      },
      {
        url: '/icons/splash-1179x2556.png',
        media: '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)',
      },
      {
        url: '/icons/splash-1284x2778.png',
        media: '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)',
      },
      {
        url: '/icons/splash-1290x2796.png',
        media: '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)',
      },
      {
        url: '/icons/splash-2796x1290.png',
        media: '(device-width: 932px) and (device-height: 430px) and (-webkit-device-pixel-ratio: 3)',
      },
      {
        url: '/icons/splash-1668x2224.png',
        media: '(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2)',
      },
      {
        url: '/icons/splash-2224x1668.png',
        media: '(device-width: 1112px) and (device-height: 834px) and (-webkit-device-pixel-ratio: 2)',
      },
      {
        url: '/icons/splash-1668x2388.png',
        media: '(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)',
      },
      {
        url: '/icons/splash-2388x1668.png',
        media: '(device-width: 1194px) and (device-height: 834px) and (-webkit-device-pixel-ratio: 2)',
      },
      {
        url: '/icons/splash-2048x2732.png',
        media: '(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)',
      },
      {
        url: '/icons/splash-2732x2048.png',
        media: '(device-width: 1366px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)',
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: '#0a84ff',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html lang="es">
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
