/**
 * app/demo/page.jsx — Ruta /demo
 * Demostración aislada de la doble capa: prueba de vida 3D (MediaPipe) +
 * verificación de identidad (face-api). No toca el flujo de fichaje real.
 */
import LivenessIdentityDemo from '../../components/LivenessIdentityDemo.jsx';
import JourneysPanel from '../../components/JourneysPanel.jsx';
import NavBar from '../../components/NavBar.jsx';

export const metadata = { title: 'Demo Vida 3D + Identidad' };

export default function DemoPage() {
  return (
    <main style={{ padding: '24px 12px', minHeight: '100vh', background: '#050A14' }}>
      <NavBar current="/demo" />
      <LivenessIdentityDemo />
      <JourneysPanel />
    </main>
  );
}
