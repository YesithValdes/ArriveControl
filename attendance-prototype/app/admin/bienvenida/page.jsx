/**
 * app/admin/bienvenida/page.jsx — Primera pantalla tras registrarse.
 *
 * Ofrece suscribirse de una, ANTES de entrar al panel. Es opcional: quien
 * prefiera mirar primero pulsa «Omitir» y se va con sus días de prueba.
 *
 * Existe porque quien ya decidió no debería tener que gastar la prueba para
 * poder pagar, y porque es el momento en que la decisión está más viva. Pero
 * no se le puede cerrar el paso a quien todavía no sabe si le sirve — de ahí
 * que omitir sea un botón visible y no un enlace escondido.
 *
 * Es una ruta FIJA, así que gana sobre el comodín `[[...seccion]]` de /admin.
 */
import { redirect } from 'next/navigation'
import { estadoAcceso } from '../../../lib/sesion'
import { estadoDelPlan } from '../../../lib/empresas.js'
import { catalogoPara } from '../../../lib/planes.js'
import { boldActivo } from '../../../lib/bold.js'
import { control, conEmpresa } from '../../../lib/db.js'
import Bienvenida from '../../../components/Bienvenida.jsx'

export const metadata = { title: 'Tu plan — AsistencIA', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function BienvenidaPage() {
  const { estado, empresa } = await estadoAcceso('ver')
  if (estado === 'SIN_SESION') redirect('/login?destino=/admin/bienvenida')
  if (estado === 'SIN_EMPRESA') redirect('/admin')
  if (estado !== 'OK') redirect('/admin')

  // Ya la resolvió antes: no se le muestra dos veces.
  if (empresa.bienvenida_en) redirect('/admin')

  const [yaPago, empleados] = await Promise.all([
    control(`select 1 from control.pagos where empresa_id = $1 and estado = 'APROBADA' limit 1`, [empresa.id])
      .then((r) => r.rows.length > 0),
    conEmpresa(empresa.esquema, async (db) =>
      Number((await db.query(`select count(*)::int as n from empleados where activo`)).rows[0].n)),
  ])

  return (
    <Bienvenida
      empresa={empresa.nombre}
      plan={estadoDelPlan(empresa)}
      catalogo={{ ...catalogoPara({ yaPago, empleados }), empleados, disponible: boldActivo() }}
    />
  )
}
