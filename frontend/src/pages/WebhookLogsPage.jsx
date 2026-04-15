import { useEffect, useState } from 'react'
import { useWebhookStore } from '../store/webhookStore'

const STATUS_COLOR = {
  RECEIVED:  'text-blue-400  bg-blue-400/10  border-blue-400/30',
  PROCESSED: 'text-green-400 bg-green-400/10 border-green-500/30',
  REJECTED:  'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  ERROR:     'text-danger     bg-danger/10     border-danger/30',
}
const PRIORITY_COLOR = {
  alta:  'text-danger',
  media: 'text-yellow-400',
  baja:  'text-muted',
}

// Intenta formatear JSON bonito; si falla devuelve el string tal cual
const prettyJson = (val) => {
  if (!val) return '—'
  try { return JSON.stringify(typeof val === 'string' ? JSON.parse(val) : val, null, 2) }
  catch { return String(val) }
}

export default function WebhookLogsPage() {
  const [expanded, setExpanded] = useState(null)
  const {
    logs, meta, filters, loading, error,
    fetchLogs, setFilters,
  } = useWebhookStore()

  useEffect(() => { fetchLogs() }, [])

  const handleFilter = (e) => { e.preventDefault(); fetchLogs() }
  const handlePage   = (next) => { setFilters({ page: next }); fetchLogs({ page: next }) }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-foreground">Webhook — Logs BuilderBot</h1>
        <button onClick={() => fetchLogs()} disabled={loading}
          className="text-xs text-muted hover:text-foreground px-3 py-1.5 border border-border rounded transition-colors disabled:opacity-50">
          {loading ? '...' : '↻ Actualizar'}
        </button>
      </div>

      {/* Filtros */}
      <form onSubmit={handleFilter} className="flex flex-wrap gap-3 mb-6">
        <div>
          <label className="block text-xs text-muted mb-1">Estado</label>
          <select
            value={filters.status || ''}
            onChange={(e) => setFilters({ status: e.target.value || undefined })}
            className="input-field py-1.5 pr-8 text-sm"
          >
            <option value="">Todos</option>
            <option>RECEIVED</option>
            <option>PROCESSED</option>
            <option>REJECTED</option>
            <option>ERROR</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Prioridad</label>
          <select
            value={filters.priority || ''}
            onChange={(e) => setFilters({ priority: e.target.value || undefined })}
            className="input-field py-1.5 pr-8 text-sm"
          >
            <option value="">Todas</option>
            <option>alta</option>
            <option>media</option>
            <option>baja</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Teléfono</label>
          <input
            value={filters.from_phone || ''}
            onChange={(e) => setFilters({ from_phone: e.target.value || undefined })}
            placeholder="+57300..."
            className="input-field py-1.5 text-sm w-44"
          />
        </div>
        <button type="submit"
          className="self-end px-4 py-[9px] bg-primary hover:bg-primary-hover text-white text-sm font-semibold rounded-md transition-colors">
          Filtrar
        </button>
      </form>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">{error}</div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && logs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted">
          <span className="text-4xl mb-3 opacity-30">💬</span>
          <p className="text-sm">Sin mensajes registrados</p>
          <p className="text-xs mt-1">Los logs aparecen cuando BuilderBot envía mensajes al webhook</p>
        </div>
      )}

      {!loading && logs.length > 0 && (
        <>
          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="bg-surface border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
                >
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                    STATUS_COLOR[log.status] || 'text-muted bg-white/5 border-white/10'
                  }`}>{log.status}</span>
                  <span className={`text-xs font-bold uppercase tracking-wider w-10 ${
                    PRIORITY_COLOR[log.priority] || 'text-muted'
                  }`}>{log.priority}</span>
                  <span className="text-sm font-mono text-foreground flex-1 truncate">{log.action}</span>
                  <span className="text-xs text-muted hidden sm:block">{log.from_phone || '—'}</span>
                  {/* campo real del backend es creado_en */}
                  <span className="text-xs text-muted whitespace-nowrap">
                    {String(log.creado_en ?? log.created_at ?? '').slice(0, 16).replace('T', ' ')}
                  </span>
                  <span className="text-muted text-xs ml-1">{expanded === log.id ? '▲' : '▼'}</span>
                </button>

                {expanded === log.id && (
                  <div className="border-t border-border/50 px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Payload recibido</p>
                      <pre className="text-xs text-foreground bg-bg rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                        {prettyJson(log.payload_preview ?? log.payload)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Respuesta enviada</p>
                      <pre className="text-xs text-foreground bg-bg rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                        {prettyJson(log.response_preview ?? log.response)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-muted">Página {meta.page} · {meta.total} logs</p>
            <div className="flex gap-2">
              <button
                disabled={meta.page <= 1 || loading}
                onClick={() => handlePage(meta.page - 1)}
                className="px-3 py-1.5 text-xs rounded border border-border text-muted hover:text-foreground hover:border-primary/50 disabled:opacity-30 transition-colors"
              >← Anterior</button>
              <button
                disabled={logs.length < 50 || loading}
                onClick={() => handlePage(meta.page + 1)}
                className="px-3 py-1.5 text-xs rounded border border-border text-muted hover:text-foreground hover:border-primary/50 disabled:opacity-30 transition-colors"
              >Siguiente →</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
