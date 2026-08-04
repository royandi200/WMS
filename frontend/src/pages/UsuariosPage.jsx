import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { listUsers, updateUserRole } from '../api/users.api'

const ROLE_LABELS = {
  admin: 'Administracion y produccion',
  recepcion_cierre: 'Recepcion y cierre',
  alistador: 'Alistamiento',
  despacho: 'Despacho',
  consulta: 'Solo consulta',
}

export default function UsuariosPage() {
  const [data, setData] = useState({ users: [], roles: [] })
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)
  const load = async () => {
    setLoading(true)
    try {
      const payload = await listUsers()
      setData(payload?.data || { users: [], roles: [] })
    } catch (error) {
      setMessage({ ok: false, text: error.response?.data?.error || 'Error al cargar usuarios' })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])
  const changeRole = async (user, role) => {
    try {
      await updateUserRole(user.id, role)
      setMessage({ ok: true, text: `Rol de ${user.nombre} actualizado` })
      await load()
    } catch (error) {
      setMessage({ ok: false, text: error.response?.data?.error || 'No fue posible cambiar el rol' })
    }
  }
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg md:text-xl font-semibold text-foreground">Usuarios y roles</h1>
        <p className="text-xs text-muted mt-1">Asignacion operativa. Las capacidades de cada rol estan versionadas en el sistema.</p>
      </div>
      {message && <div className={`mb-4 px-4 py-3 border text-sm ${message.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'}`}>{message.text}</div>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm min-w-[760px]">
          <thead><tr className="bg-surface border-b border-border">
            {['Usuario', 'Correo', 'Telefono', 'Estado', 'Rol'].map((label) => <th key={label} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{label}</th>)}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">Cargando usuarios...</td></tr>}
            {!loading && data.users.map((user) => (
              <tr key={user.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-medium text-foreground inline-flex items-center gap-2"><ShieldCheck size={15} className="text-muted" />{user.nombre}</td>
                <td className="px-4 py-3 text-muted">{user.email}</td>
                <td className="px-4 py-3 font-mono text-xs">{user.telefono || '-'}</td>
                <td className="px-4 py-3"><span className={user.activo ? 'text-green-400' : 'text-muted'}>{user.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td className="px-4 py-3">
                  <select value={user.rol || ''} onChange={(event) => changeRole(user, event.target.value)} className="input-field max-w-[220px]" disabled={!user.activo}>
                    {!data.roles.some((role) => role.nombre === user.rol) && <option value={user.rol}>{ROLE_LABELS[user.rol] || user.rol || 'Sin rol'}</option>}
                    {data.roles.map((role) => <option key={role.id} value={role.nombre}>{ROLE_LABELS[role.nombre] || role.nombre}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
