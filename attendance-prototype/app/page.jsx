/**
 * app/page.jsx — Pantalla principal (raíz).
 * El sistema inicia en el modo kiosco: la tablet/celular fijo que valida a
 * quien se acerque (identificación facial 1:N) y registra entrada/salida.
 * El panel del administrador vive en /admin (ruta escondida).
 */
import KioskMode from '../components/KioskMode.jsx';

export const metadata = {
  title: 'Control de Asistencia',
  description: 'Kiosco de fichaje con reconocimiento facial y prueba de vida',
};

export default function Page() {
  return (
    <main style={{ padding: '24px 12px', minHeight: '100vh' }}>
      <KioskMode />
    </main>
  );
}
