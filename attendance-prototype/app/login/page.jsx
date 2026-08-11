'use client'

/**
 * app/login/page.jsx — Inicio de sesión.
 *
 * Usuarios PROPIOS de ArriveControl (esquema `asistencia`). Aquí no se crean
 * cuentas: las da de alta un dueño desde Ajustes → Usuarios.
 */
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from '../../lib/auth-client'

// useSearchParams() exige un límite de <Suspense> para el prerender del build.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
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

  // Correo y contraseña solo existen en desarrollo (ver lib/auth.js). En
  // producción el formulario ni se pinta: entrar es entrar con Google.
  const conClave = process.env.NODE_ENV !== 'production'

  const destino = params.get('destino') || '/admin'

  // Google se lleva la página entera y vuelve al callback; no hay promesa que
  // esperar ni router.push que hacer después.
  const entrarConGoogle = () => {
    setError('')
    setCargando(true)
    signIn.social({ provider: 'google', callbackURL: destino })
  }

  async function enviar(e) {
    e.preventDefault()
    setError('')
    setCargando(true)
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
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <form
        onSubmit={enviar}
        style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>ArriveControl</h1>
          <p style={{ margin: '6px 0 0', opacity: 0.7, fontSize: 14 }}>
            Panel de asistencia
          </p>
        </div>

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
            <p style={{ margin: 0, fontSize: 12, opacity: 0.55, textAlign: 'center' }}>
              solo en desarrollo
            </p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
              Correo
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 15 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
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
    </main>
  )
}
