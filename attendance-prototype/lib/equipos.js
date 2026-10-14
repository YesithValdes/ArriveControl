// En pantalla se llaman «áreas»; internamente (tablas, permisos) siguen siendo «equipos».
export const COLORES_AREA = ['#2b6cb0', '#6d4fd8', '#c27410', '#7a8699', '#15803d', '#be3a5a', '#0f8a8a', '#8a5a2b']

export function validarEquipo(datos) {
  if (!datos || typeof datos !== 'object') throw Object.assign(new Error('Datos inválidos.'), { status: 400 })
  const nombre = String(datos.nombre ?? '').trim().replace(/\s+/g, ' ')
  const descripcion = String(datos.descripcion ?? '').trim()
  if (!nombre || nombre.length > 100) throw Object.assign(new Error('El nombre debe tener entre 1 y 100 caracteres.'), { status: 400 })
  if (descripcion.length > 500) throw Object.assign(new Error('La descripción admite hasta 500 caracteres.'), { status: 400 })
  if (!Array.isArray(datos.miembros) || datos.miembros.length > 1000 || datos.miembros.some(id => typeof id !== 'string' || !id || id.length > 100)) throw Object.assign(new Error('Selecciona una lista válida de colaboradores.'), { status: 400 })
  const responsable = datos.responsable_id == null || datos.responsable_id === '' ? null : datos.responsable_id
  if (responsable !== null && (typeof responsable !== 'string' || responsable.length > 100)) throw Object.assign(new Error('Responsable inválido.'), { status: 400 })
  const color = String(datos.color ?? COLORES_AREA[0]).toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(color)) throw Object.assign(new Error('Color inválido.'), { status: 400 })
  return { nombre, descripcion, miembros: [...new Set(datos.miembros)], responsable_id: responsable, activa: datos.activa !== false, color }
}

export async function guardarEquipo(db, id, datos) {
  const c = validarEquipo(datos)
  const actual = id ? (await db.query('select responsable_id from equipos where id=$1 for update', [id])).rows[0] : null
  if (id && !actual) throw Object.assign(new Error('Área no encontrada.'), { status: 404 })
  // Quien ya era integrante puede seguir aunque esté inactivo: así quitar o
  // agregar a otra persona no obliga a sacar a los archivados.
  if (c.miembros.length) {
    const validos = await db.query('select id from empleados where id=any($1::text[]) and (activo or id in (select empleado_id from equipo_miembros where equipo_id=$2)) for share', [c.miembros, id ?? ''])
    if (validos.rowCount !== c.miembros.length) throw Object.assign(new Error('Uno de los colaboradores no pertenece a la empresa o está inactivo.'), { status: 400 })
  }
  if (c.responsable_id && c.responsable_id !== actual?.responsable_id && !(await db.query('select id from empleados where id=$1 and activo', [c.responsable_id])).rowCount) throw Object.assign(new Error('El responsable no pertenece a la empresa o está inactivo.'), { status: 400 })
  const campos = [c.nombre, c.descripcion, c.responsable_id, c.activa, c.color]
  const equipo = id
    ? (await db.query('update equipos set nombre=$2,descripcion=$3,responsable_id=$4,activa=$5,color=$6 where id=$1 returning id,nombre,descripcion,responsable_id,activa,color', [id, ...campos])).rows[0]
    : (await db.query('insert into equipos(nombre,descripcion,responsable_id,activa,color) values($1,$2,$3,$4,$5) returning id,nombre,descripcion,responsable_id,activa,color', campos)).rows[0]
  await db.query('delete from equipo_miembros where equipo_id=$1', [equipo.id])
  if (c.miembros.length) await db.query('insert into equipo_miembros(equipo_id,empleado_id) select $1,unnest($2::text[])', [equipo.id, c.miembros])
  return { ...equipo, miembros: c.miembros }
}
