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
  title: 'Control de Asistencia',
  // PWA instalable: sin manifest con íconos 192/512, Chrome ofrece "agregar
  // a inicio" pero RECHAZA la instalación real como app.
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png', // iOS no lee el manifest: necesita su propio tag
  },
  appleWebApp: {
    capable: true,
    title: 'ArriveControl',
    statusBarStyle: 'default',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#16224e',
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
