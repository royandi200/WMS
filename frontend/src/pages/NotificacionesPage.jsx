import { useEffect, useState } from 'react'
import { RefreshCw, RotateCw } from 'lucide-react'
import { listNotifications, retryNotification } from '../api/notifications.api'

export default function NotificacionesPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(null)
  const [message, setMessage] = useState(null)
  const load = async () => {
    setLoading(true)
    try {
      const payload = await listNotifications({ limit: 200 })
      setRows(payload?.data?.rows || [])
    } catch (error) {
      setMessage({ ok: false, text: error.response?.data?.error || 'Error al cargar notificaciones' })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])
  const retry = async (id) => {
    setWorking(id)
    try {
      await retryNotification(id)
      setMessage({ ok: true, text: 'Notificacion reenviada' })
      await load()
    } catch (error) {
      setMessage({ ok: false, text: error.response?.data?.error || 'No fue posible reenviar' })
    } finally {
      setWorking(null)
    }
  }
  const formatDate = (value) => value ? String(value).replace('T', ' ').slice(0, 16) : '-'
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg md:text-xl font-semibold text-foreground">Notificaciones</h1>
          <p className="text-xs text-muted mt-1">Entregas operativas por WhatsApp y errores pendientes.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} title="Actualizar" className="w-9 h-9 inline-flex items-center justify-center border border-border text-muted hover:text-foreground">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {message && <div className={`mb-4 px-4 py-3 border text-sm ${message.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'}`}>{message.text}</div>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm min-w-[980px]">
          <thead><tr className="bg-surface border-b border-border">
            {['Evento', 'Canal', 'Destino', 'Mensaje', 'Estado', 'Intentos', 'Fecha', 'Accion'].map((label) => <th key={label} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{label}</th>)}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">Cargando notificaciones...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">Sin notificaciones registradas</td></tr>}
            {!loading && rows.map((row) => <tr key={row.id} className="border-b border-border/50 hover:bg-white/[0.02]">
              <td className="px-4 py-3 font-mono text-xs">{row.evento}</td>
              <td className="px-4 py-3 text-xs">{row.canal}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.destinatario}</td>
              <td className="px-4 py-3 max-w-sm truncate" title={row.mensaje}>{row.mensaje}</td>
              <td className={`px-4 py-3 text-xs font-semibold ${row.estado === 'ENVIADA' ? 'text-green-400' : row.estado === 'ERROR' ? 'text-danger' : 'text-yellow-400'}`}>{row.estado}</td>
              <td className="px-4 py-3 tabular-nums">{row.intentos}</td>
              <td className="px-4 py-3 text-xs text-muted">{formatDate(row.enviado_en || row.creado_en)}</td>
              <td className="px-4 py-3">{row.estado === 'ERROR' ? <button type="button" onClick={() => retry(row.id)} disabled={working === row.id} title="Reintentar envio" className="w-8 h-8 inline-flex items-center justify-center text-primary hover:bg-primary/10"><RotateCw size={15} className={working === row.id ? 'animate-spin' : ''} /></button> : '-'}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
