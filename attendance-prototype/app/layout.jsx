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
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
