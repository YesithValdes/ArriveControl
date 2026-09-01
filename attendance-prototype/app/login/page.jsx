'use client'

/**
 * app/login/page.jsx — Inicio de sesión de AsistencIA.
 *
 * Pantalla dividida: a la izquierda la marca e información del sistema, a la
 * derecha el formulario. Usuarios PROPIOS del sistema (esquema `asistencia`).
 * Aquí no se crean cuentas: las da de alta un dueño desde Ajustes → Usuarios.
 */
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn, signOut, useSession } from '../../lib/auth-client'

// useSearchParams() exige un límite de <Suspense> para el prerender del build.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

/* Logotipo oficial «Presente ✓»: un rostro cuya mandíbula es un chulo de
   verificación. El mismo arte de public/icon.svg, en blanco y aguamarina. */
function LogoAsistencia({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="31" r="20" stroke="#fff" strokeWidth="4.6" fill="none" />
      <circle cx="25.4" cy="27" r="2.2" fill="#fff" />
      <circle cx="38.6" cy="27" r="2.2" fill="#fff" />
      <path d="M 24 37 l 6 6 l 12 -12" stroke="#9fdcca" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(params.get('error') === 'sin-permiso'
    ? 'Tu usuario no tiene acceso. Pídeselo al administrador.'
    : '')
  const [cargando, setCargando] = useState(false)

  // Correo y contraseña SIEMPRE disponibles, pero como segunda opción: Google
  // arriba porque es quien verifica la identidad, y la contraseña abajo para
  // los sitios donde Google no funciona — sobre todo la app de Android, donde
  // Google bloquea su propio inicio de sesión.
  const conClave = true

  const destino = params.get('destino') || '/admin'

  // ¿Ya hay alguien conectado en este navegador?
  const { data: sesionActiva } = useSession()
  const [saliendo, setSaliendo] = useState(false)

  /**
   * Cierra la sesión que hubiera ANTES de abrir una nueva.
   *
   * Sin esto, entrar con otra cuenta encima de una sesión viva dejaba al
   * servidor viendo al usuario anterior: la persona elegía su otra cuenta en
   * Google, volvía al panel y seguía siendo la primera. La única salida era
   * borrar las cookies a mano desde el inspector.
   *
   * Aquí el fallo NO se ignora: si la sesión vieja no muere, iniciar otra
   * encima repetiría exactamente el problema que esto viene a resolver.
   */
  const limpiarSesionPrevia = async () => {
    if (!sesionActiva?.user) return true
    try {
      await signOut()
      return true
    } catch {
      setError('No se pudo cerrar la sesión anterior. Recarga la página e inténtalo de nuevo.')
      setCargando(false)
      return false
    }
  }

  // Google se lleva la página entera y vuelve al callback; no hay promesa que
  // esperar ni router.push que hacer después.
  const entrarConGoogle = async () => {
    setError('')
    setCargando(true)
    if (!(await limpiarSesionPrevia())) return
    signIn.social({ provider: 'google', callbackURL: destino })
  }

  /** Salir de la cuenta actual sin entrar a otra: deja el login limpio. */
  const salirDeLaCuenta = async () => {
    setError('')
    setSaliendo(true)
    try { await signOut() } catch { setError('No se pudo cerrar la sesión. Recarga la página.') }
    setSaliendo(false)
  }

  async function enviar(e) {
    e.preventDefault()
    setError('')
    setCargando(true)
    if (!(await limpiarSesionPrevia())) return
    const { error: err } = await signIn.email({ email, password })
    setCargando(false)
    if (err) {
      setError(err.message === 'Invalid email or password'
        ? 'Correo o contraseña incorrectos.'
        : err.message || 'No se pudo iniciar sesión.')
      return
    }
    router.push(params.get('destino') || '/admin')
    router.refresh()
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'linear-gradient(160deg, #3a5570 0%, #557d9e 100%)',
      }}
    >
      {/* En móvil solo se muestra el formulario: la mitad de marca se oculta. */}
      <style>{`
        /* Sin este reset (globals.css no lo trae), el padding de inputs y
           botones se suma al ancho y se salen de la tarjeta en móvil. */
        .login-tarjeta, .login-tarjeta * { box-sizing: border-box; }
        .login-tarjeta input { width: 100%; min-width: 0; }
        .login-tarjeta section { min-width: 0; }
        @media (max-width: 720px) {
          .login-marca { display: none !important; }
          .login-tarjeta { grid-template-columns: 1fr !important; }
          .login-tarjeta section { padding: 32px 20px; }
        }
      `}</style>
      {/* Tarjeta redondeada que encierra las dos mitades. */}
      <div
        className="login-tarjeta"
        style={{
          width: '100%', maxWidth: 980,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(2, 6, 23, 0.45)',
          background: '#fff',
        }}
      >
      {/* Mitad izquierda: marca e información del sistema. */}
      <section
        className="login-marca"
        style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          gap: 20, padding: '48px 40px', minHeight: 560,
          background: 'linear-gradient(160deg, #0f172a 0%, #1e3a5f 100%)',
          color: '#fff',
        }}
      >
        <LogoAsistencia />
        <div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, letterSpacing: -0.5 }}>
            Asistenc<span style={{ color: '#9fdcca' }}>IA</span>
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 16, opacity: 0.85, maxWidth: 420 }}>
            Registro y control de asistencia para tu empresa: entradas, salidas
            y novedades de tus colaboradores en un solo lugar.
          </p>
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 15, opacity: 0.9 }}>
          <li>✓ Marcación en kiosco con verificación de rostro</li>
          <li>✓ Control por sedes y ubicación GPS</li>
          <li>✓ Reportes de asistencia y novedades</li>
        </ul>
      </section>

      {/* Mitad derecha: formulario de ingreso. */}
      <section style={{ display: 'grid', placeItems: 'center', padding: 24, background: '#f8fafc' }}>
        <form
          onSubmit={enviar}
          style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#0f172a' }}>
              Iniciar sesión
            </h2>
            <p style={{ margin: '6px 0 0', opacity: 0.7, fontSize: 14, color: '#0f172a' }}>
              Accede al panel de asistencia
            </p>
          </div>

          {/* Decirlo ANTES de que lo intente: quien llega aquí con sesión viva
              casi siempre viene justo a cambiar de cuenta, y hasta ahora el
              cambio fallaba en silencio. */}
          {sesionActiva?.user && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              padding: '12px 14px', borderRadius: 8,
              background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 13.5, color: '#1e3a5f',
            }}>
              <span>
                Ya hay una sesión abierta como <b>{sesionActiva.user.email}</b>.
                Si entras con otra cuenta, esta se cerrará.
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => { window.location.href = destino }}
                  style={{
                    padding: '7px 13px', borderRadius: 7, border: '1px solid #93c5fd',
                    background: '#fff', color: '#1e3a5f', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Continuar como {sesionActiva.user.name?.split(' ')[0] || 'esta cuenta'}
                </button>
                <button
                  type="button"
                  onClick={salirDeLaCuenta}
                  disabled={saliendo}
                  style={{
                    padding: '7px 13px', borderRadius: 7, border: '1px solid transparent',
                    background: 'transparent', color: '#1e3a5f', fontSize: 13, fontWeight: 600,
                    cursor: saliendo ? 'default' : 'pointer', textDecoration: 'underline', opacity: saliendo ? 0.6 : 1,
                  }}
                >
                  {saliendo ? 'Cerrando…' : 'Cerrar esta sesión'}
                </button>
              </div>
            </div>
          )}

          {/* Único camino en producción. Un solo botón: entrar y registrarse son
              lo mismo — quien llega sin empresa recibe la suya al entrar. */}
          <button
            type="button"
            onClick={entrarConGoogle}
            disabled={cargando}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '11px 16px', borderRadius: 8, border: '1px solid #cbd5e1',
              fontSize: 15, fontWeight: 600, background: '#fff', color: '#0f172a',
              cursor: cargando ? 'default' : 'pointer', opacity: cargando ? 0.6 : 1,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-3.9H24v7.1h12.1c-.2 1.8-1.6 4.6-4.5 6.4l6.9 5.3c4.1-3.8 6.6-9.4 6.6-14.9z" />
              <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46z" />
              <path fill="#FBBC05" d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 10z" />
              <path fill="#EA4335" d="M24 10.6c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.4 29.9 2 24 2 15.4 2 8.1 6.9 4.4 14l7.1 5.5c1.8-5.3 6.7-8.9 12.5-8.9z" />
            </svg>
            {cargando ? 'Abriendo Google…' : 'Continuar con Google'}
          </button>

          {error && (
            <p role="alert" style={{ margin: 0, color: '#b91c1c', fontSize: 14 }}>{error}</p>
          )}

          {/* Solo en desarrollo: poder trabajar sin credenciales de OAuth ni red. */}
          {conClave && (
            <>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.55, textAlign: 'center', color: '#0f172a' }}>
                solo en desarrollo
              </p>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, color: '#0f172a' }}>
                Correo
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 15 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, color: '#0f172a' }}>
                Contraseña
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 15 }}
                />
              </label>
              <button
                type="submit"
                disabled={cargando}
                style={{
                  padding: '11px 16px', borderRadius: 8, border: 'none', fontSize: 15, fontWeight: 600,
                  background: cargando ? '#94a3b8' : '#0f172a', color: '#fff',
                  cursor: cargando ? 'default' : 'pointer',
                }}
              >
                {cargando ? 'Entrando…' : 'Entrar'}
              </button>
            </>
          )}
        </form>
      </section>
      </div>
    </main>
  )
}
