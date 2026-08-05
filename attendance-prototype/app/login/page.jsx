'use client'

/**
 * app/login/page.jsx — Inicio de sesión.
 *
 * Las credenciales son las MISMAS de la plataforma de Gestión Humana: ambas
 * apps comparten la base de datos de usuarios. Aquí no se crean cuentas; el
 * alta la hace el administrador en el gestor (Configuración → Usuarios).
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
    ? 'Tu usuario no tiene permiso sobre el módulo de asistencia. Pídeselo al administrador.'
    : '')
  const [cargando, setCargando] = useState(false)

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
            Entra con tu usuario de la plataforma de Gestión Humana.
          </p>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
          Correo
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
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
            required
            autoComplete="current-password"
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 15 }}
          />
        </label>

        {error && (
          <p role="alert" style={{ margin: 0, color: '#b91c1c', fontSize: 14 }}>{error}</p>
        )}

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
      </form>
    </main>
  )
}
