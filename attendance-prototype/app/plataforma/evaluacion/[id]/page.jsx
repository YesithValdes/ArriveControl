/**
 * app/plataforma/evaluacion/[id]/page.jsx — Evaluación de modelos faciales de
 * UNA empresa, desde la consola del superadmin. Misma puerta que /plataforma:
 * quien no es superadmin no la ve.
 */
import { redirect } from 'next/navigation';
import EvaluacionSface from '../../../../components/EvaluacionSface.jsx';
import { obtenerSesion } from '../../../../lib/sesion';
import { esSuperadmin } from '../../../../lib/roles.js';

export const metadata = { title: 'Evaluación de modelos — Plataforma', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function Page({ params }) {
  const usuario = await obtenerSesion();
  const { id } = await params;
  if (!usuario) redirect(`/login?destino=/plataforma/evaluacion/${encodeURIComponent(id)}`);
  if (!usuario.activo || !esSuperadmin(usuario)) redirect('/admin');
  return <EvaluacionSface api={`/api/plataforma/empresas/${encodeURIComponent(id)}/evaluacion`} volver="/plataforma" />;
}
