import MapaBodega from '../components/MapaBodega'
import { useEffect, useState } from 'react'
import { useInventoryStore } from '../store/inventoryStore'

const TABS = ['Resumen', 'Stock Bajo', 'Buscar Producto', 'Buscar Lote', 'Mapa Bodega']

export default function InventarioPage() {
  const [tab, setTab] = useState(0)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [searched, setSearched] = useState(false)

  const {
    summary, lowStock, loading, error,
    fetchSummary, fetchLowStock, fetchProductStock, fetchLotDetail, clearError,
  } = useInventoryStore()

  useEffect(() => { fetchSummary() }, [])
  useEffect(() => { if (tab === 1) fetchLowStock() }, [tab])
  useEffect(() => { setQuery(''); setResult(null); setSearched(false); clearError() }, [tab])

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearched(false)
    const data = tab === 2
      ? await fetchProductStock(query.trim())
      : await fetchLotDetail(query.trim())
    setResult(data)
    setSearched(true)
  }

  return (
    <div>
      <h1 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Inventario</h1>

      <div className="flex gap-1 mb-4 md:mb-6 border-b border-border overflow-x-auto pb-px scrollbar-none">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === i
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">
          {error}
        </div>
      )}

      {tab === 0 && (
        <div>
          {loading && !summary && <Spinner />}
          {summary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(summary).map(([k, v]) => (
                <div key={k} className="bg-surface border border-border rounded-lg p-4">
                  <p className="text-xs text-muted mb-1 capitalize">{k.replace(/_/g, ' ')}</p>
                  <p className="text-2xl font-bold text-primary tabular-nums">{v ?? '—'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 1 && (
        <div>
          {loading && <Spinner />}
          {!loading && lowStock.length === 0 && (
            <EmptyState icon="▦" text="No hay productos bajo mínimo" />
          )}
          {lowStock.length > 0 && (
            <Table
              cols={['SKU', 'Producto', 'Stock actual', 'Mínimo', 'Diferencia']}
              rows={lowStock.map((r) => [
                r.sku || r.id,
                r.name || '—',
                <span className="text-danger font-semibold tabular-nums">{r.stock ?? '—'}</span>,
                r.min_stock ?? '—',
                <span className="text-danger tabular-nums">{r.min_stock != null && r.stock != null ? r.min_stock - r.stock : '—'}</span>,
              ])}
            />
          )}
        </div>
      )}

      {tab === 2 && (
        <SearchPane
          label="SKU o ID del producto"
          placeholder="Ej: RM-TAP-MED"
          query={query}
          setQuery={setQuery}
          onSearch={handleSearch}
          loading={loading}
        >
          {searched && result && <ProductResult data={result} />}
          {searched && !result && !loading && <EmptyState icon="▦" text="Producto no encontrado" />}
        </SearchPane>
      )}

      {tab === 3 && (
        <SearchPane
          label="LPN del lote"
          placeholder="Ej: L-2024-001"
          query={query}
          setQuery={setQuery}
          onSearch={handleSearch}
          loading={loading}
        >
          {searched && result && <LotResult data={result} />}
          {searched && !result && !loading && <EmptyState icon="▦" text="Lote no encontrado" />}
        </SearchPane>
      )}
      {tab === 4 && (
        <MapaBodega />
      )}
    </div>
  )
}

function SearchPane({ label, placeholder, query, setQuery, onSearch, loading, children }) {
  return (
    <div>
      <form onSubmit={onSearch} className="flex gap-2 mb-6 max-w-md">
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">{label}</label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="input-field"
          />
        </div>
        <button type="submit" disabled={loading} className="self-end btn-sm">
          {loading ? <SpinnerXs /> : 'Buscar'}
        </button>
      </form>
      {children}
    </div>
  )
}

function ProductResult({ data }) {
  const product = data.product || {}
  const totals = data.totals || {}
  const rows = Array.isArray(data.rows) ? data.rows : []
  const blockedRows = rows.filter((r) => Number(r.bloqueada || 0) > 0)
  const displayRows = [...rows].sort((a, b) => Number(b.disponible || 0) - Number(a.disponible || 0))

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-border rounded-lg p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <p className="text-xs text-muted mb-1">Producto</p>
            <h2 className="text-lg font-semibold text-foreground">{product.name || '-'}</h2>
            <p className="text-xs font-mono text-muted mt-1">{product.sku || product.id || '-'}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 min-w-[280px]">
            <Metric label="Disponible" value={totals.disponible} tone="text-green-400" />
            <Metric label="Reservado" value={totals.reservada} tone="text-yellow-400" />
            <Metric label="Bloqueado" value={totals.bloqueada} tone="text-red-400" />
            <Metric label="Total" value={totals.cantidad} tone="text-primary" />
          </div>
        </div>
        {blockedRows.length > 0 && (
          <div className="mt-4 px-3 py-2 rounded border border-danger/30 bg-danger/10 text-danger text-sm">
            {blockedRows.length} lote(s) no estan disponibles: revisa estado, vencimiento y ubicacion.
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm min-w-[780px]">
          <thead>
            <tr className="bg-surface border-b border-border">
              {['Lote', 'Bodega', 'Ubicacion', 'Estado', 'Vence', 'Cantidad', 'Reservado', 'Disponible'].map((c) => (
                <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r) => (
              <tr key={r.stock_id || r.lote || r.lpn} className="border-b border-border/50 hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-mono text-xs">{r.lote || r.lpn || '-'}</td>
                <td className="px-4 py-3">{r.bodega_codigo || r.bodega_nombre || '-'}</td>
                <td className="px-4 py-3">{r.ubicacion_codigo || r.ubicacion_zona || '-'}</td>
                <td className="px-4 py-3"><StatusBadge value={r.estado_calculado || r.lot_status || 'DISPONIBLE'} /></td>
                <td className="px-4 py-3 text-muted text-xs">{formatDate(r.expiry_date || r.fecha_venc)}</td>
                <td className="px-4 py-3 tabular-nums">{r.cantidad ?? '-'}</td>
                <td className="px-4 py-3 tabular-nums">{r.reservada ?? '-'}</td>
                <td className="px-4 py-3 tabular-nums font-semibold text-foreground">{r.disponible ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LotResult({ data }) {
  const lot = data.lot || data
  return (
    <div className="bg-surface border border-border rounded-lg p-5 max-w-2xl">
      <p className="text-xs text-muted mb-1">Lote</p>
      <h2 className="text-lg font-semibold font-mono text-foreground">{lot.lpn || lot.lote || '-'}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <Metric label="SKU" value={lot.sku || lot.siigo_code || '-'} />
        <Metric label="Cantidad" value={lot.qty_current ?? lot.cantidad ?? '-'} />
        <Metric label="Estado" value={lot.status || lot.estado_calculado || '-'} />
        <Metric label="Vence" value={formatDate(lot.expiry_date || lot.fecha_venc)} />
      </div>
    </div>
  )
}

function Metric({ label, value, tone = 'text-foreground' }) {
  return (
    <div className="rounded border border-border bg-background/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${tone}`}>{value ?? '-'}</p>
    </div>
  )
}

function StatusBadge({ value }) {
  const status = String(value || '').toUpperCase()
  const css = status === 'DISPONIBLE'
    ? 'text-green-400 bg-green-400/10'
    : status === 'CUARENTENA'
      ? 'text-yellow-400 bg-yellow-400/10'
      : 'text-danger bg-danger/10'
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${css}`}>{status}</span>
}

function formatDate(value) {
  if (!value) return '-'
  return String(value).slice(0, 10)
}

function Table({ cols, rows }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[600px]">
        <thead>
          <tr className="bg-surface border-b border-border">
            {cols.map((c) => <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-white/[0.02] transition-colors">
              {row.map((cell, j) => <td key={j} className="px-4 py-3 text-foreground">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({ icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted">
      <span className="text-4xl mb-3 opacity-30">{icon}</span>
      <p className="text-sm">{text}</p>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function SpinnerXs() {
  return <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
}
