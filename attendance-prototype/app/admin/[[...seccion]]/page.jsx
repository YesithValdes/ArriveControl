/**
 * app/admin/[[...seccion]]/page.jsx — Panel del administrador.
 *
 * Ruta COMODÍN: atiende /admin y todas sus pantallas (/admin/empleados,
 * /admin/ajustes/sedes…). El panel sigue siendo un solo componente; de aquí
 * solo sale con qué pantalla abrirse, para que recargar no devuelva siempre
 * al dashboard. La tabla de direcciones vive en lib/rutasPanel.js.
 *
 * /admin/registro sigue funcionando: una ruta fija gana sobre el comodín.
 *
 * Protegido con la sesión y los roles PROPIOS de ArriveControl (lib/roles.js).
 * Requiere al menos la acción `ver`; el panel esconde lo que el rol no permita.
 *
 * La tipografía (Montserrat) y los tokens de diseño ya vienen del layout raíz.
 */
import { redirect } from 'next/navigation';
import AdminPanel from '../../../components/AdminPanel.jsx';
import DefinirContrasena from '../../../components/DefinirContrasena.jsx';
import { estadoAcceso, tienePermiso } from '../../../lib/sesion';
import { tabDeSegmentos } from '../../../lib/rutasPanel.js';
import { estadoDelPlan } from '../../../lib/empresas.js';

export const metadata = {
  title: 'Panel del administrador',
  robots: { index: false, follow: false }, // ruta escondida: no indexar
};

// La sesión se lee por cookie en cada visita: nunca cachear esta página.
export const dynamic = 'force-dynamic';

export default async function AdminPage({ params }) {
  const { seccion } = await params;
  const { estado, usuario, empresa, sedeLimite } = await estadoAcceso('ver');

  if (estado === 'SIN_SESION') redirect('/login?destino=/admin');
  if (estado === 'SIN_PERMISO' || estado === 'CUENTA_INACTIVA') redirect('/login?error=sin-permiso');

  // Sin empresa no hay panel que mostrar. El superadmin va al suyo; quien
  // quedó sin empresa por un fallo del alta ve qué hacer.
  if (estado === 'SIN_EMPRESA') {
    if (usuario?.rol === 'superadmin') redirect('/plataforma');
    return (
      <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Tu cuenta no tiene empresa</h1>
          <p style={{ opacity: 0.7, fontSize: 14 }}>Vuelve a entrar. Si sigue igual, escríbenos.</p>
        </div>
      </main>
    );
  }

  // El panel necesita saber qué puede hacer quien entró, para esconder lo demás.
  const permisos = {
    corregir: tienePermiso(usuario, 'corregir'),
    empleados: tienePermiso(usuario, 'empleados'),
    config: tienePermiso(usuario, 'config'),
    usuarios: tienePermiso(usuario, 'usuarios'),
    liquidar: tienePermiso(usuario, 'liquidar'),
  };

  // Último paso del registro: ponerle contraseña a la app. Se pide aquí y no
  // en un ajuste escondido porque quien entró con Google NO puede abrir el
  // panel desde el celular sin ella —Google bloquea su inicio de sesión dentro
  // de una app— y lo descubriría el día que lo necesite, lejos del computador.
  if (!usuario.tieneContrasena) {
    return <DefinirContrasena correo={usuario.email} />;
  }

  // Sin <Suspense>: hacía falta cuando el panel leía `?tab=` con
  // useSearchParams. Ahora la pantalla inicial viene de la ruta, que el
  // servidor ya conoce.
  return (
    <AdminPanel
      seccionInicial={tabDeSegmentos(seccion)}
      sesion={{
        nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, sedeLimite,
        empresa: empresa?.nombre ?? null,
        foto: usuario.foto ?? null, // la de la cuenta de Google, si entró así
        // Para el aviso de tope y el banner de suscripción, sin otra petición.
        plan: empresa?.plan ?? 'gratis',
        estadoSuscripcion: empresa?.estado ?? 'activa',
        limiteEmpleados: empresa?.limite_empleados ?? null,
        // Prueba gratuita: días que quedan, si ya venció y con qué tope se
        // quedó. Lo calcula el servidor para que la pantalla no rehaga la
        // regla y termine diciendo algo distinto.
        planEstado: estadoDelPlan(empresa),
      }}
      permisos={permisos}
    />
  );
}
