/**
 * app/layout.jsx — Raíz de la app.
 * Carga el sistema de diseño (globals.css) y Montserrat para TODAS las
 * pantallas, no solo el panel: la tipografía es parte de la marca.
 */
import { Montserrat } from 'next/font/google';
import ServiceWorkerRegister from '../components/ServiceWorkerRegister.jsx';
import './globals.css';

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '600', '700', '800'],
  variable: '--font-montserrat',
  display: 'swap',
});

export const metadata = {
  title: 'AsistencIA',
  // PWA instalable: sin manifest con íconos 192/512, Chrome ofrece "agregar
  // a inicio" pero RECHAZA la instalación real como app.
  manifest: '/manifest.webmanifest',
  icons: {
    // El SVG escala a cualquier tamaño; el PNG queda de respaldo.
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png', // iOS no lee el manifest: necesita su propio tag
  },
  appleWebApp: {
    capable: true,
    title: 'AsistencIA',
    statusBarStyle: 'default',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#3a5570',
  // Sin cover, env(safe-area-inset-*) siempre vale 0 y el contenido queda
  // detrás del notch/barra de gestos en la PWA instalada (y en Capacitor).
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={montserrat.variable}>
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
