import ServiceWorkerRegister from '../components/ServiceWorkerRegister.jsx';

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
    <html lang="es">
      <body style={{ margin: 0, background: '#f9fafb' }}>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
