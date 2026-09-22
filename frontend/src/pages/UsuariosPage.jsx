import { useEffect, useState } from 'react'
import { Pencil, Save, ShieldCheck, X } from 'lucide-react'
import { listUsers, updateUserPhone, updateUserRoles } from '../api/users.api'

const ROLE_LABELS = {
  admin: 'Administración y producción',
  recepcion_cierre: 'Recepción y cierre',
  alistador: 'Alistamiento',
  despacho: 'Despacho',
  consulta: 'Solo consulta',
}

export default function UsuariosPage() {
  const [data, setData] = useState({ users: [], roles: [] })
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)
  const [phoneEditor, setPhoneEditor] = useState({ userId: null, value: '', saving: false })
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
  const changeRole = async (user, role, checked) => {
    const current = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.rol].filter(Boolean)
    const roles = checked
      ? [...new Set([...current, role])]
      : current.filter((assigned) => assigned !== role)
    if (!roles.length) {
      setMessage({ ok: false, text: 'Cada usuario debe conservar al menos un rol' })
      return
    }
    try {
      await updateUserRoles(user.id, roles)
      setMessage({ ok: true, text: `Roles de ${user.nombre} actualizados` })
      await load()
    } catch (error) {
      setMessage({ ok: false, text: error.response?.data?.error || 'No fue posible cambiar el rol' })
    }
  }
  const startPhoneEdit = (user) => {
    setPhoneEditor({ userId: user.id, value: user.telefono || '', saving: false })
    setMessage(null)
  }
  const cancelPhoneEdit = () => setPhoneEditor({ userId: null, value: '', saving: false })
  const savePhone = async (user) => {
    const value = phoneEditor.value.trim()
    if (!value) {
      setMessage({ ok: false, text: 'Ingresa el nuevo número de celular' })
      return
    }
    setPhoneEditor((current) => ({ ...current, saving: true }))
    try {
      await updateUserPhone(user.id, value)
      setMessage({ ok: true, text: `Celular de ${user.nombre} actualizado` })
      cancelPhoneEdit()
      await load()
    } catch (error) {
      setMessage({ ok: false, text: error.response?.data?.error || 'No fue posible actualizar el celular' })
      setPhoneEditor((current) => ({ ...current, saving: false }))
    }
  }
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg md:text-xl font-semibold text-foreground">Usuarios y roles</h1>
        <p className="text-xs text-muted mt-1">Asignación operativa. Las capacidades de cada rol están versionadas en el sistema.</p>
      </div>
      {message && <div className={`mb-4 px-4 py-3 border text-sm ${message.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'}`}>{message.text}</div>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm min-w-[760px]">
          <thead><tr className="bg-surface border-b border-border">
            {['Usuario', 'Correo', 'Teléfono', 'Estado', 'Roles'].map((label) => <th key={label} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{label}</th>)}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">Cargando usuarios...</td></tr>}
            {!loading && data.users.map((user) => (
              <tr key={user.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-medium text-foreground inline-flex items-center gap-2"><ShieldCheck size={15} className="text-muted" />{user.nombre}</td>
                <td className="px-4 py-3 text-muted">{user.email}</td>
                <td className="px-4 py-3 text-xs min-w-[230px]">
                  {phoneEditor.userId === user.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="tel"
                        inputMode="tel"
                        autoFocus
                        value={phoneEditor.value}
                        onChange={(event) => setPhoneEditor((current) => ({ ...current, value: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') savePhone(user)
                          if (event.key === 'Escape') cancelPhoneEdit()
                        }}
                        placeholder="Ej. 315 000 0000"
                        aria-label={`Celular de ${user.nombre}`}
                        className="input-field h-9 min-w-0 font-mono text-xs"
                        disabled={phoneEditor.saving}
                      />
                      <button type="button" onClick={() => savePhone(user)} disabled={phoneEditor.saving} title="Guardar celular" className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-green-400 hover:bg-green-400/10 disabled:opacity-50"><Save size={15} /></button>
                      <button type="button" onClick={cancelPhoneEdit} disabled={phoneEditor.saving} title="Cancelar" className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-muted hover:bg-white/5 disabled:opacity-50"><X size={15} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{user.telefono || 'Sin número'}</span>
                      <button type="button" onClick={() => startPhoneEdit(user)} disabled={!user.activo} title={user.telefono ? 'Editar celular' : 'Agregar celular'} className="inline-flex h-8 w-8 items-center justify-center text-primary hover:bg-primary/10 disabled:opacity-40"><Pencil size={14} /></button>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3"><span className={user.activo ? 'text-green-400' : 'text-muted'}>{user.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td className="px-4 py-3">
                  <div className="grid min-w-[260px] grid-cols-2 gap-x-3 gap-y-2">
                    {data.roles.map((role) => {
                      const assigned = (user.roles || [user.rol]).includes(role.nombre)
                      return <label key={role.id} className="inline-flex items-center gap-2 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={assigned}
                          onChange={(event) => changeRole(user, role.nombre, event.target.checked)}
                          disabled={!user.activo}
                          className="accent-primary"
                        />
                        {ROLE_LABELS[role.nombre] || role.nombre}
                      </label>
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
