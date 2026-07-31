/**
 * app/admin/page.jsx — Ruta escondida /admin
 * Panel del administrador. La tipografía (Montserrat) y los tokens de diseño
 * ya vienen del layout raíz — aquí solo se monta el panel.
 */
import AdminPanel from '../../components/AdminPanel.jsx';

export const metadata = {
  title: 'Panel del administrador',
  robots: { index: false, follow: false }, // ruta escondida: no indexar
};

export default function AdminPage() {
  return <AdminPanel />;
}
