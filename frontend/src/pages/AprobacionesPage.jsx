import { useEffect, useMemo, useState } from 'react'
import { useApprovalsStore } from '../store/approvalsStore'

const TIPO_LABEL = {
  ajuste: 'Ajuste',
  SOLICITAR_INICIO_PRODUCCION: 'Inicio producción',
  REPORTAR_MERMA: 'Merma',
  REPORTE_MERMA: 'Merma',
  SOLICITAR_CIERRE_PRODUCCION: 'Cierre producción',
  SOLICITAR_DESPACHO: 'Despacho',
  GESTION_DEVOLUCION: 'Devolución',
  INGRESO_RECEPCION: 'Recepción',
}

const ESTADO_LABEL = {
  PENDIENTE: 'Pendiente',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
  EXPIRADO: 'Expirado',
}

const ESTADO_CLASS = {
  PENDIENTE: 'bg-yellow-400/10 text-yellow-400',
  APROBADO: 'bg-green-500/10 text-green-400',
  RECHAZADO: 'bg-danger/10 text-danger',
  EXPIRADO: 'bg-slate-500/10 text-slate-300',
}

const norm = (item) => ({
  id: item.id,
  codigoSolicitud: item.codigo_solicitud ?? item.request_code ?? '',
  tipo: item.tipo ?? item.accion ?? item.type ?? '',
  estado: item.estado ?? 'PENDIENTE',
  cantidad: item.cantidad ?? item.qty ?? '',
  lote: item.lote ?? item.lot ?? '',
  fecha: item.creado_en ?? item.created_at ?? item.fecha ?? '',
  fechaProcesado: item.procesado_en ?? item.processed_at ?? '',
  producto: item.producto_nombre ?? item.producto ?? item.description ?? item.id_item ?? `#${String(item.id).slice(0,8)}`,
  sku: item.siigo_code ?? item.sku ?? '',
  bodegaOrig: item.bodega_orig_nombre ?? '',
  bodegaDest: item.bodega_dest_nombre ?? '',
  usuario: item.usuario_nombre ?? item.from_phone ?? '',
  procesadoPor: item.procesado_por_nombre ?? '',
  motivoRechazo: item.motivo_rechazo ?? '',
})

export default function AprobacionesPage() {
  const [tab, setTab] = useState('pending')
  const [selected, setSelected] = useState(null)
  const [noteRej, setNoteRej] = useState('')
  const [toast, setToast] = useState(null)

  const {
    pendingList,
    historyList,
    loadingPending,
    loadingHistory,
    error,
    fetchPending,
    fetchHistory,
    approve,
    reject,
  } = useApprovalsStore()

  useEffect(() => {
    fetchPending({ limit: 50 })
    fetchHistory({ limit: 50 })
  }, [])

  const showToast = (msg, ok) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 4000) }

  const handleApprove = async (item) => {
    const res = await approve({ request_code: item.codigoSolicitud })
    if (res.ok) {
      showToast('✓ Solicitud aprobada', true)
      await Promise.all([fetchPending({ limit: 50 }), fetchHistory({ limit: 50 })])
    } else {
      showToast(res.message, false)
    }
    setSelected(null)
  }

  const handleReject = async (item) => {
    const res = await reject({ request_code: item.codigoSolicitud, reason: noteRej })
    if (res.ok) {
      showToast('✕ Solicitud rechazada', true)
      await Promise.all([fetchPending({ limit: 50 }), fetchHistory({ limit: 50 })])
    } else {
      showToast(res.message, false)
    }
    setSelected(null)
    setNoteRej('')
  }

  const pendingItems = useMemo(() => (pendingList || []).map(norm), [pendingList])
  const historyItems = useMemo(() => (historyList || []).map(norm), [historyList])
  const loading = tab === 'pending' ? loadingPending : loadingHistory
  const items = tab === 'pending' ? pendingItems : historyItems

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-xl font-semibold text-foreground">Aprobaciones</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1">
            <button
              onClick={() => setTab('pending')}
              className={`text-xs px-3 py-1 rounded-md transition-colors ${tab === 'pending' ? 'bg-primary/10 text-primary font-semibold' : 'text-muted hover:text-foreground'}`}
            >
              Pendientes ({pendingItems.length})
            </button>
            <button
              onClick={() => setTab('history')}
              className={`text-xs px-3 py-1 rounded-md transition-colors ${tab === 'history' ? 'bg-primary/10 text-primary font-semibold' : 'text-muted hover:text-foreground'}`}
            >
              Histórico ({historyItems.length})
            </button>
          </div>
          <button
            onClick={() => Promise.all([fetchPending({ limit: 50 }), fetchHistory({ limit: 50 })])}
            disabled={loadingPending || loadingHistory}
            className="text-xs text-muted hover:text-foreground px-3 py-1.5 border border-border rounded transition-colors disabled:opacity-50"
          >
            {loadingPending || loadingHistory ? '...' : 'Actualizar'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">{error}</div>}

      {toast && (
        <div className={`mb-4 px-4 py-3 rounded-lg border text-sm ${toast.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'}`}>
          {toast.msg}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted">
          <span className="text-4xl mb-3 opacity-30">✓</span>
          <p className="text-sm font-medium text-foreground">{tab === 'pending' ? 'Todo al día' : 'Sin histórico'}</p>
          <p className="text-xs mt-1">
            {tab === 'pending' ? 'No hay solicitudes pendientes de aprobación' : 'Todavía no hay aprobaciones procesadas'}
          </p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.codigoSolicitud || item.id} className="bg-surface border border-border rounded-lg p-4 hover:border-primary/40 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {TIPO_LABEL[item.tipo] || item.tipo}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${ESTADO_CLASS[item.estado] || 'bg-surface border border-border text-muted'}`}>
                      {ESTADO_LABEL[item.estado] || item.estado}
                    </span>
                    <span className="text-xs text-muted">
                      {String(item.fecha).slice(0,16).replace('T',' ')}
                    </span>
                  </div>

                  <p className="text-sm text-foreground font-medium">{item.producto}</p>

                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted">
                    {item.codigoSolicitud && <span>Req: <span className="font-mono text-primary">{item.codigoSolicitud}</span></span>}
                    {item.sku && <span>SKU: <span className="font-mono text-primary">{item.sku}</span></span>}
                    {item.cantidad !== '' && item.cantidad != null && <span>Cant: <strong className="text-foreground">{item.cantidad}</strong></span>}
                    {item.lote && <span>Lote: <span className="font-mono">{item.lote}</span></span>}
                    {item.bodegaOrig && <span>← {item.bodegaOrig}</span>}
                    {item.bodegaDest && <span>→ {item.bodegaDest}</span>}
                    {item.usuario && <span>👤 {item.usuario}</span>}
                    {item.procesadoPor && tab === 'history' && <span>Procesó: <strong className="text-foreground">{item.procesadoPor}</strong></span>}
                    {item.fechaProcesado && tab === 'history' && <span>Procesado: {String(item.fechaProcesado).slice(0,16).replace('T',' ')}</span>}
                  </div>

                  {item.motivoRechazo && tab === 'history' && (
                    <div className="mt-2 text-xs text-danger bg-danger/10 border border-danger/20 rounded-md px-2.5 py-2">
                      Motivo rechazo: {item.motivoRechazo}
                    </div>
                  )}
                </div>

                {tab === 'pending' ? (
                  selected?.codigoSolicitud === item.codigoSolicitud ? (
                    <div className="flex flex-col gap-2 min-w-[220px]">
                      <textarea
                        value={noteRej}
                        onChange={(e) => setNoteRej(e.target.value)}
                        placeholder="Motivo rechazo (opcional)"
                        rows={2}
                        className="input-field resize-none text-xs"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => handleApprove(item)} className="flex-1 py-1.5 text-xs font-semibold rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/30 transition-colors">
                          ✓ Aprobar
                        </button>
                        <button onClick={() => handleReject(item)} className="flex-1 py-1.5 text-xs font-semibold rounded bg-danger/10 text-danger hover:bg-danger/20 border border-danger/30 transition-colors">
                          ✕ Rechazar
                        </button>
                      </div>
                      <button onClick={() => setSelected(null)} className="text-xs text-muted hover:text-foreground text-center">
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
                  )
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
