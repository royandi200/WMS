import { useEffect, useState } from 'react'
import { useInventoryStore } from '../store/inventoryStore'

const MOV_COLOR = {
  ENTRADA:  'text-green-400',
  SALIDA:   'text-danger',
  AJUSTE:   'text-yellow-400',
  MERMA:    'text-orange-400',
  TRASLADO: 'text-blue-400',
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

  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground mb-6">Kardex — Movimientos</h1>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6 max-w-md">
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">Filtrar por SKU (opcional)</label>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="Ej: RM-TAP-MED"
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

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">{error}</div>}

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
                  {['Fecha','Tipo','Producto','Lote','Cantidad','Saldo','Referencia'].map((c) => (
                    <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kardex.map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-muted text-xs whitespace-nowrap">{r.created_at?.slice(0,16).replace('T',' ')}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold ${MOV_COLOR[r.type] || 'text-muted'}`}>{r.type}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{r.product_id?.slice(0,8)}…</td>
                    <td className="px-4 py-3 text-muted text-xs">{r.lot_id?.slice(0,8) || '—'}</td>
                    <td className={`px-4 py-3 tabular-nums font-semibold ${MOV_COLOR[r.type] || 'text-foreground'}`}>
                      {r.type === 'SALIDA' || r.type === 'MERMA' ? `-${r.qty}` : `+${r.qty}`}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground">{r.balance ?? '—'}</td>
                    <td className="px-4 py-3 text-muted text-xs">{r.reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-muted">
              Página {page} · {kardexMeta.total} movimientos
            </p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1 || loading}
                onClick={() => { setPage((p) => p - 1); load(page - 1) }}
                className="px-3 py-1.5 text-xs rounded border border-border text-muted hover:text-foreground hover:border-primary/50 disabled:opacity-30 transition-colors"
              >← Anterior</button>
              <button
                disabled={kardex.length < 30 || loading}
                onClick={() => { setPage((p) => p + 1); load(page + 1) }}
                className="px-3 py-1.5 text-xs rounded border border-border text-muted hover:text-foreground hover:border-primary/50 disabled:opacity-30 transition-colors"
              >Siguiente →</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
