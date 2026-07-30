'use client';

/**
 * components/HRPanel.jsx
 * Panel simple de Recursos Humanos para aprobar/revocar los registros de
 * dispositivos. En producción esto sería una vista protegida por rol en
 * Supabase (solo usuarios RRHH), no accesible por el empleado.
 */

import { useEffect, useState } from 'react';
import {
  listRegistrations,
  approveRegistration,
  revokeRegistration,
} from '../services/webauthnService.js';

export default function HRPanel() {
  const [rows, setRows] = useState([]);

  const refresh = () => setRows(listRegistrations());
  useEffect(refresh, []);

  const handleApprove = (id) => { approveRegistration(id); refresh(); };
  const handleRevoke = (id) => { revokeRegistration(id); refresh(); };

  return (
    <div style={styles.card}>
      <h3 style={{ margin: '0 0 4px' }}>👥 Panel de Recursos Humanos</h3>
      <p style={styles.sub}>Aprueba el registro de cada dispositivo antes de que el empleado pueda fichar.</p>

      {rows.length === 0 && <p style={styles.sub}>No hay dispositivos registrados aún.</p>}

      {rows.map((r) => (
        <div key={r.employeeId} style={styles.row}>
          <div>
            <strong>{r.employeeId}</strong> — {r.employeeName}
            <div style={styles.meta}>
              {r.status === 'approved' ? '✅ Aprobado' : '⏳ Pendiente'} · dispositivo …{(r.credentialId || '????????').slice(-8)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {r.status !== 'approved' && (
              <button style={styles.approve} onClick={() => handleApprove(r.employeeId)}>Aprobar</button>
            )}
            <button style={styles.revoke} onClick={() => handleRevoke(r.employeeId)}>Revocar</button>
          </div>
        </div>
      ))}

      <button style={styles.refresh} onClick={refresh}>🔄 Actualizar</button>
    </div>
  );
}

const styles = {
  card: { maxWidth: 420, margin: '24px auto 0', padding: 20, fontFamily: 'system-ui, sans-serif', border: '1px dashed #cbd5e1', borderRadius: 16, background: '#f8fafc' },
  sub: { fontSize: 13, color: '#6b7280', margin: '0 0 12px' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid #e5e7eb' },
  meta: { fontSize: 12, color: '#6b7280' },
  approve: { padding: '6px 12px', border: 'none', borderRadius: 8, background: '#16a34a', color: '#fff', cursor: 'pointer' },
  revoke: { padding: '6px 12px', border: 'none', borderRadius: 8, background: '#dc2626', color: '#fff', cursor: 'pointer' },
  refresh: { marginTop: 12, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer' },
};
