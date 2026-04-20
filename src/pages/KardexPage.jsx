import { useEffect, useState } from 'react'
import { useInventoryStore } from '../store/inventoryStore'

// ── Mapa de action → label legible + color ───────────────────
const ACTION_META = {
  INGRESO_RECEPCION:    { label: 'Ingreso Recepción',    color: 'text-green-400',  sign: '+' },
  INGRESO_NOVEDAD:      { label: 'Ingreso Novedad',      color: 'text-green-300',  sign: '+' },
  CIERRE_PRODUCCION:    { label: 'Cierre Producción',    color: 'text-emerald-400',sign: '+' },
  PRODUCCION_PLANEADA:  { label: 'Producción Planeada',  color: 'text-sky-400',    sign: '+' },
  CONSUMO_MATERIAL:     { label: 'Consumo Material',     color: 'text-orange-400', sign: '-' },
  DESPACHO:             { label: 'Despacho',             color: 'text-red-400',    sign: '-' },
  MERMA_PROCESO:        { label: 'Merma Proceso',        color: 'text-red-500',    sign: '-' },
  MERMA_BODEGA:         { label: 'Merma Bodega',         color: 'text-red-500',    sign: '-' },
  MERMA_CIERRE_WIP:     { label: 'Merma Cierre WIP',    color: 'text-red-500',    sign: '-' },
  DEVOLUCION:           { label: 'Devolución',           color: 'text-yellow-400', sign: '+' },
  EXCEPCION_FIFO:       { label: 'Excepción FIFO',       color: 'text-yellow-500', sign: '±' },
  AJUSTE_RETORNO:       { label: 'Ajuste Retorno',       color: 'text-blue-400',   sign: '±' },
  AJUSTE_MANUAL:        { label: 'Ajuste Manual',        color: 'text-blue-400',   sign: '±' },
  SOLICITUD_RECHAZADA:  { label: 'Solicitud Rechazada',  color: 'text-muted',      sign: '—' },
  AVANCE_FASE:          { label: 'Avance Fase',          color: 'text-sky-300',    sign: '±' },
  SIIGO_SYNC:           { label: 'Sync Siigo',           color: 'text-muted',      sign: '±' },
}

function getActionMeta(action = '') {
  return ACTION_META[action] ?? { label: action, color: 'text-muted', sign: '' }
}

function fmtQty(qty, sign) {
  const n = parseFloat(qty)
  if (sign === '+') return `+${Math.abs(n).toFixed(3)}`
  if (sign === '-') return `-${Math.abs(n).toFixed(3)}`
  return (n >= 0 ? `+${n.toFixed(3)}` : n.toFixed(3))
}

export default function KardexPage() {
  const [sku, setSku]   = useState('')
  const [page, setPage] = useState(1)
  const { kardex, kardexMeta, loading, error, fetchKardex, clearError } = useInventoryStore()

  const load = (p = 1) => fetchKardex({ sku: sku.trim() || undefined, page: p, limit: 30 })

  const handleSearch = (e) => {
    e.preventDefault()
    setPage(1)
    load(1)
  }

  useEffect(() => { load() }, [])

  const COLS = ['Fecha', 'Acción', 'Producto', 'Lote', 'Cantidad', 'Saldo', 'Referencia', 'Aprobado por']

  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground mb-6">Kardex — Movimientos</h1>

      {/* Filtro */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-6 max-w-md">
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">Filtrar por SKU (opcional)</label>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="Ej: PT-MIXB-60"
            className="input-field"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="self-end px-4 py-[11px] bg-primary hover:bg-primary-hover text-white text-sm font-semibold rounded-md transition-colors disabled:opacity-50"
        >
          {loading ? '...' : 'Filtrar'}
        </button>
      </form>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && kardex.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted">
          <span className="text-4xl mb-3 opacity-30">≡</span>
          <p className="text-sm">Sin movimientos registrados</p>
        </div>
      )}

      {!loading && kardex.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface border-b border-border">
                  {COLS.map((c) => (
                    <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kardex.map((r, i) => {
                  const meta  = getActionMeta(r.action)
                  const qty   = parseFloat(r.qty ?? 0)
                  const lpn   = r.lot_lpn || '—'
                  const lpnShort = lpn !== '—' && lpn.length > 20 ? lpn.slice(0, 20) + '…' : lpn

                  return (
                    <tr key={i} className="border-b border-border/50 hover:bg-white/[0.02]">
                      {/* Fecha */}
                      <td className="px-4 py-3 text-muted text-xs whitespace-nowrap">
                        {r.created_at?.slice(0, 16).replace('T', ' ')}
                      </td>

                      {/* Acción */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-xs font-semibold ${meta.color}`}>
                          {meta.label}
                        </span>
                      </td>

                      {/* Producto */}
                      <td className="px-4 py-3">
                        <p className="text-xs font-mono text-foreground">{r.sku || '—'}</p>
                        {r.product_name && (
                          <p className="text-[10px] text-muted truncate max-w-[140px]">{r.product_name}</p>
                        )}
                      </td>

                      {/* Lote */}
                      <td className="px-4 py-3 text-muted text-xs font-mono" title={lpn}>
                        {lpnShort}
                      </td>

                      {/* Cantidad */}
                      <td className={`px-4 py-3 tabular-nums font-semibold ${meta.color}`}>
                        {fmtQty(qty, meta.sign)}
                      </td>

                      {/* Saldo */}
                      <td className="px-4 py-3 tabular-nums text-foreground text-xs">
                        {r.balance_after != null ? parseFloat(r.balance_after).toFixed(3) : '—'}
                      </td>

                      {/* Referencia */}
                      <td className="px-4 py-3 text-muted text-xs max-w-[140px]">
                        <p className="truncate">{r.reference || '—'}</p>
                        {r.notes && <p className="text-[10px] truncate opacity-60">{r.notes}</p>}
                      </td>

                      {/* Aprobado por */}
                      <td className="px-4 py-3 text-muted text-xs whitespace-nowrap">
                        {r.aprobado_por || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-muted">
              Página {page} · {kardexMeta.total} movimientos
            </p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1 || loading}
                onClick={() => { const p = page - 1; setPage(p); load(p) }}
                className="px-3 py-1.5 text-xs rounded border border-border text-muted hover:text-foreground hover:border-primary/50 disabled:opacity-30 transition-colors"
              >← Anterior</button>
              <button
                disabled={kardex.length < 30 || loading}
                onClick={() => { const p = page + 1; setPage(p); load(p) }}
                className="px-3 py-1.5 text-xs rounded border border-border text-muted hover:text-foreground hover:border-primary/50 disabled:opacity-30 transition-colors"
              >Siguiente →</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
