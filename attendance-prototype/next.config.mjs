/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Los .sql de la plantilla de empresa TIENEN que viajar al servidor.
   *
   * Al registrarse alguien con Google, `crearEmpresa()` (lib/empresas.js) crea
   * el esquema del nuevo cliente y le corre `db/migrations/empresa/*.sql`, que
   * lee del disco con `readFileSync`. Next solo empaqueta los archivos que ve
   * IMPORTADOS, y un .sql leído así no lo detecta: en Vercel no viajaría, el
   * alta reventaría con ENOENT y la persona quedaría sin empresa.
   *
   * Es un fallo que no aparece en local —donde el proyecto entero está en
   * disco— y que rompe justo la función principal del producto.
   *
   * OJO al cambiar esto: la clave es la ruta que ACABA llamando a
   * `crearEmpresa`. Hoy es una sola —el hook `user.create.after` de Better
   * Auth, que corre dentro de /api/auth/[...all]— pero si algún día se agrega
   * un endpoint para que el superadmin cree empresas a mano, hay que sumarlo
   * aquí o fallará solo en producción.
   */
  outputFileTracingIncludes: {
    '/api/auth/[...all]': ['./db/migrations/empresa/**/*.sql'],
  },
};

export default nextConfig;
