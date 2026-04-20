import { useEffect, useState } from 'react'
import { useInventoryStore } from '../store/inventoryStore'

const MOV_COLOR = {
  ENTRADA: 'text-green-400',
  SALIDA: 'text-danger',
  AJUSTE: 'text-yellow-400',
  MERMA: 'text-orange-400',
  TRASLADO: 'text-blue-400',
  DESPACHO: 'text-danger',
  INGRESO_RECEPCION: 'text-green-400',
  CIERRE_PRODUCCION: 'text-green-400',
  CONSUMO_MATERIAL: 'text-danger',
  MERMA_PROCESO: 'text-orange-400',
  MERMA_BODEGA: 'text-orange-400',
  AJUSTE_MANUAL: 'text-yellow-400',
  DEVOLUCION: 'text-green-400',
}

const NEGATIVE_TYPES = new Set([
  'SALIDA',
  'MERMA',
  'DESPACHO',
  'CONSUMO_MATERIAL',
  'MERMA_PROCESO',
  'MERMA_BODEGA',
])

const norm = (r) => ({
  fecha: r.fecha ?? r.created_at ?? r.creado_en ?? '',
  tipo: r.tipo ?? r.type ?? r.action ?? '',
  producto: r.producto ?? r.product_name ?? r.product_sku ?? r.sku ?? r.product_id ?? r.producto_id ?? '—',
  lote: r.lote ?? r.lot_lpn ?? r.lote_id ?? r.lot_id ?? '—',
  cantidad: r.cantidad ?? r.qty ?? r.quantity ?? 0,
  saldo: r.saldo ?? r.balance_after ?? r.balance ?? '—',
  referencia: r.referencia ?? r.reference ?? r.ref ?? '—',
})

export default function KardexPage() {
  const [skuInput, setSkuInput] = useState('')
  const [page, setPage] = useState(1)
  const { kardex, kardexMeta, loading, error, fetchKardex } = useInventoryStore()

  const load = (p = 1) => fetchKardex({
    ...(skuInput.trim() ? { sku: skuInput.trim() } : {}),
    page: p,
    limit: 30,
  })

  const handleSearch = (e) => { e.preventDefault(); setPage(1); load(1) }

  useEffect(() => { load() }, [])

  const rows = kardex.map(norm)

  return (
    <div>
      <h1 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Kardex — Movimientos</h1>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6 max-w-md">
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">Filtrar por SKU (opcional)</label>
          <input
            value={skuInput}
            onChange={(e) => setSkuInput(e.target.value)}
            placeholder="Ej: EM-BOT-500"
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
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">{error}</div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted">
          <span className="text-4xl mb-3 opacity-30">≡</span>
          <p className="text-sm">Sin movimientos registrados</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="bg-surface border-b border-border">
                  {['Fecha', 'Tipo', 'Producto', 'Lote', 'Cantidad', 'Saldo', 'Referencia'].map((c) => (
                    <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isNegative = NEGATIVE_TYPES.has(String(r.tipo || '').toUpperCase()) || Number(r.cantidad) < 0
                  const cantidadAbs = Math.abs(Number(r.cantidad || 0))

                  return (
                    <tr key={i} className="border-b border-border/50 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-muted text-xs whitespace-nowrap">
                        {String(r.fecha).slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold ${MOV_COLOR[r.tipo] || 'text-muted'}`}>{r.tipo || '—'}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-primary">{r.producto}</td>
                      <td className="px-4 py-3 text-muted text-xs">{r.lote && r.lote !== '—' ? String(r.lote).slice(0, 24) : '—'}</td>
                      <td className={`px-4 py-3 tabular-nums font-semibold ${isNegative ? 'text-danger' : 'text-green-400'}`}>
                        {`${isNegative ? '-' : '+'}${cantidadAbs}`}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground">{r.saldo}</td>
                      <td className="px-4 py-3 text-muted text-xs">{r.referencia}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-muted">
              Página {page} · {kardexMeta.total} movimientos totales
            </p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1 || loading}
                onClick={() => { const p = page - 1; setPage(p); load(p) }}
                className="px-3 py-1.5 text-xs rounded border border-border text-muted hover:text-foreground hover:border-primary/50 disabled:opacity-30 transition-colors"
              >← Anterior</button>
              <button
                disabled={rows.length < 30 || loading}
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
