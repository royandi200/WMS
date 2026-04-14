import { useEffect, useState } from 'react'
import { useApprovalsStore } from '../store/approvalsStore'

const TYPE_LABEL = {
  SOLICITAR_INICIO_PRODUCCION: 'Inicio producción',
  REPORTAR_MERMA:              'Merma',
  SOLICITAR_CIERRE_PRODUCCION: 'Cierre producción',
  SOLICITAR_DESPACHO:          'Despacho',
  GESTION_DEVOLUCION:          'Devolución',
}

export default function AprobacionesPage() {
  const [selected, setSelected] = useState(null)
  const [noteRej,  setNoteRej]  = useState('')
  const [toast,    setToast]    = useState(null)
  const { list, loading, error, fetchList, approve, reject } = useApprovalsStore()

  useEffect(() => { fetchList() }, [])

  const showToast = (msg, ok) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 4000) }

  const handleApprove = async (item) => {
    const res = await approve({ id: item.id })
    if (res.ok) showToast('✓ Solicitud aprobada', true)
    else showToast(res.message, false)
    setSelected(null)
  }

  const handleReject = async (item) => {
    const res = await reject({ id: item.id, reason: noteRej })
    if (res.ok) showToast('✕ Solicitud rechazada', true)
    else showToast(res.message, false)
    setSelected(null)
    setNoteRej('')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-foreground">Aprobaciones</h1>
        <div className="flex items-center gap-2">
          {list.length > 0 && (
            <span className="text-xs bg-primary/10 text-primary font-semibold px-2.5 py-1 rounded-full">
              {list.length} pendiente{list.length !== 1 ? 's' : ''}
            </span>
          )}
          <button onClick={fetchList} disabled={loading}
            className="text-xs text-muted hover:text-foreground px-3 py-1.5 border border-border rounded transition-colors disabled:opacity-50">
            {loading ? '...' : 'Actualizar'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">{error}</div>}

      {toast && (
        <div className={`mb-4 px-4 py-3 rounded-lg border text-sm ${
          toast.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'
        }`}>{toast.msg}</div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && list.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted">
          <span className="text-4xl mb-3 opacity-30">✓</span>
          <p className="text-sm font-medium text-foreground">Todo al día</p>
          <p className="text-xs mt-1">No hay solicitudes pendientes de aprobación</p>
        </div>
      )}

      {/* Lista de solicitudes */}
      {!loading && list.length > 0 && (
        <div className="space-y-3">
          {list.map((item) => (
            <div key={item.id}
              className="bg-surface border border-border rounded-lg p-4 hover:border-primary/40 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold bg-yellow-400/10 text-yellow-400 px-2 py-0.5 rounded-full">
                      {TYPE_LABEL[item.type] || item.type}
                    </span>
                    <span className="text-xs text-muted">{item.created_at?.slice(0,16).replace('T',' ')}</span>
                  </div>
                  <p className="text-sm text-foreground font-medium truncate">
                    {item.description || `Solicitud #${item.id?.slice(0,8)}`}
                  </p>
                  {item.from_phone && (
                    <p className="text-xs text-muted mt-0.5">📱 {item.from_phone}</p>
                  )}
                </div>

                {/* Acciones */}
                {selected?.id === item.id ? (
                  <div className="flex flex-col gap-2 min-w-[180px]">
                    <textarea
                      value={noteRej}
                      onChange={(e) => setNoteRej(e.target.value)}
                      placeholder="Motivo rechazo (opcional)"
                      rows={2}
                      className="input-field resize-none text-xs"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => handleApprove(item)}
                        className="flex-1 py-1.5 text-xs font-semibold rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/30 transition-colors">
                        ✓ Aprobar
                      </button>
                      <button onClick={() => handleReject(item)}
                        className="flex-1 py-1.5 text-xs font-semibold rounded bg-danger/10 text-danger hover:bg-danger/20 border border-danger/30 transition-colors">
                        ✕ Rechazar
                      </button>
                    </div>
                    <button onClick={() => setSelected(null)}
                      className="text-xs text-muted hover:text-foreground text-center">
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setSelected(item)}
                    className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded border border-border text-muted hover:text-foreground hover:border-primary/50 transition-colors"
                  >
                    Gestionar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
