/**
 * app/fichaje/page.jsx — Ruta escondida /fichaje
 * Fichaje individual desde el celular del empleado (GPS + biometría del
 * dispositivo vía WebAuthn). Se abre desde Administrador → Ajustes.
 */
import AttendanceModule from '../../components/AttendanceModule.jsx';

export const metadata = {
  title: 'Fichaje individual',
  robots: { index: false, follow: false },
};

export default function FichajePage() {
  return (
    <main
      style={{
        height: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <AttendanceModule employeeId="EMP-001" employeeName="Empleado Demo" />
    </main>
  );
}
