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

  /**
   * Los MODELOS faciales (~10 MB entre face-api y MediaPipe) no cambian nunca:
   * son pesos congelados. Sin esta cabecera, cada apertura del kiosco los
   * revalidaba contra el servidor y el arranque pagaba esa vuelta; con caché
   * inmutable de 30 días, la tablet los lee de disco y el arranque en frío
   * solo es lento la PRIMERA vez.
   */
  async headers() {
    return [
      {
        source: '/:carpeta(models|wasm)/:archivo*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=2592000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
