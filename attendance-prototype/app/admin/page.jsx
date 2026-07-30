/**
 * app/admin/page.jsx — Ruta escondida /admin
 * Panel del administrador. Tipografía: Montserrat (cargada con next/font),
 * diferenciando roles por peso y espaciado.
 */
import { Montserrat } from 'next/font/google';
import AdminPanel from '../../components/AdminPanel.jsx';

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '600', '700', '800'],
  variable: '--font-montserrat',
});

export const metadata = {
  title: 'Panel del administrador',
  robots: { index: false, follow: false }, // ruta escondida: no indexar
};

export default function AdminPage() {
  return (
    <div className={montserrat.variable}>
      <AdminPanel />
    </div>
  );
}
