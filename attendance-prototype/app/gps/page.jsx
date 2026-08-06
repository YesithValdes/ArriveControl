/**
 * app/gps/page.jsx — Ruta /gps
 * Diagnóstico de la señal GPS: coordenadas crudas, precisión y distancia a
 * cada sede en vivo. Útil para saber si la "distancia errónea" es por GPS.
 */
import GpsDebug from '../../components/GpsDebug.jsx';
import NavBar from '../../components/NavBar.jsx';

export const metadata = { title: 'Diagnóstico GPS' };

export default function GpsPage() {
  return (
    <main style={{ padding: '24px 12px', minHeight: '100dvh' }}>
      <NavBar current="/gps" />
      <GpsDebug />
    </main>
  );
}
