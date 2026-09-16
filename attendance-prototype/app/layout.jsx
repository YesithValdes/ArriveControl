/**
 * app/layout.jsx — Raíz de la app.
 * Carga el sistema de diseño (globals.css) y Montserrat para TODAS las
 * pantallas, no solo el panel: la tipografía es parte de la marca.
 */
import { Montserrat, Sora } from 'next/font/google';
import ServiceWorkerRegister from '../components/ServiceWorkerRegister.jsx';
import './globals.css';

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '600', '700', '800'],
  variable: '--font-montserrat',
  display: 'swap',
});

// Sora: la letra de los mensajes DENTRO del cuadro del kiosco (geométrica,
// números claros, un 800 que se lee de lejos). Va por next/font y no por un
// <link> a Google Fonts a propósito: así se sirve desde /_next/static, que el
// Service Worker guarda, y el kiosco la tiene aunque se caiga el internet.
const sora = Sora({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-sora',
  display: 'swap',
});

export const metadata = {
  title: 'AsistencIA',
  // PWA instalable: sin manifest con íconos 192/512, Chrome ofrece "agregar
  // a inicio" pero RECHAZA la instalación real como app.
  manifest: '/manifest.webmanifest',
  icons: {
    // El SVG escala a cualquier tamaño; el PNG queda de respaldo.
    //
    // El `?v=` NO es adorno: una app ya instalada se queda con el icono que
    // guardó el día que se instaló, y cambiar el contenido del archivo sin
    // cambiar su dirección no la entera de nada. Al mover el número, la
    // dirección es otra y el sistema lo vuelve a pedir.
    //
    // AL CAMBIAR EL LOGO, SUBIR ESTE NÚMERO — aquí y en manifest.webmanifest.
    icon: [
      { url: '/icon.svg?v=3', type: 'image/svg+xml' },
      { url: '/icon-192.png?v=3', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png?v=3', // iOS no lee el manifest: necesita su propio tag
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
  themeColor: '#1e3a5f',
  // Sin cover, env(safe-area-inset-*) siempre vale 0 y el contenido queda
  // detrás del notch/barra de gestos en la PWA instalada (y en Capacitor).
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${montserrat.variable} ${sora.variable}`}>
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
