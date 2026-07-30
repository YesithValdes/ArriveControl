/**
 * components/NavBar.jsx
 * Navegación entre pantallas (necesaria en la PWA del celular, que no tiene
 * barra de direcciones). Usa <Link> de Next para cambiar de ruta sin recargar.
 */
import Link from 'next/link';

const link = {
  padding: '8px 14px',
  borderRadius: 999,
  border: '1px solid #22304A',
  background: '#141E31',
  color: '#E8EEF9',
  textDecoration: 'none',
  fontSize: 14,
  fontFamily: 'system-ui, sans-serif',
};
const active = { ...link, background: '#3B82F6', color: '#fff', border: '1px solid #3B82F6' };

export default function NavBar({ current }) {
  // Solo el fichaje es público. El panel del administrador vive en /admin
  // como ruta escondida (se entra escribiendo la URL); las pantallas
  // técnicas (kiosco, GPS, laboratorio) se abren desde Administrador → Ajustes.
  const items = [
    { href: '/', label: '🖥️ Kiosco' },
  ];
  return (
    <nav style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', maxWidth: 460, margin: '0 auto 16px' }}>
      {items.map((it) => (
        <Link key={it.href} href={it.href} style={current === it.href ? active : link}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
