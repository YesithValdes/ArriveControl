import EvaluacionSface from '../../components/EvaluacionSface.jsx';

export const metadata = { title: 'Evaluación de modelos · AsistencIA', robots: { index: false, follow: false } };

// El acceso lo decide la API (sesión con permiso de colaboradores y empresa
// habilitada por el superadmin): sin eso, la pantalla solo muestra el motivo.
export default function Page() {
  return <EvaluacionSface />;
}
