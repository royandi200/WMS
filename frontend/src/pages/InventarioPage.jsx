import { useEffect, useState } from 'react'
import { useInventoryStore } from '../store/inventoryStore'

const TABS = ['Resumen', 'Stock Bajo', 'Buscar Producto', 'Buscar Lote']

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
      <h1 className="text-xl font-semibold text-foreground mb-6">Inventario</h1>

      <div className="flex gap-1 mb-6 border-b border-border">
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
              cols={['SKU / ID', 'Producto', 'Stock actual', 'Mínimo', 'Diferencia']}
              rows={lowStock.map((r) => [
                r.iditem || r.sku,
                r.nombre || r.name || '—',
                <span className="text-danger font-semibold tabular-nums">{r.stock_actual ?? r.qty}</span>,
                r.stock_minimo ?? r.min_stock,
                <span className="text-danger tabular-nums">{((r.stock_minimo ?? r.min_stock) - (r.stock_actual ?? r.qty))}</span>,
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
          {searched && result && <JsonCard data={result} />}
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
          {searched && result && <JsonCard data={result} />}
          {searched && !result && !loading && <EmptyState icon="▦" text="Lote no encontrado" />}
        </SearchPane>
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

function JsonCard({ data }) {
  return (
    <pre className="bg-surface border border-border rounded-lg p-4 text-xs text-foreground overflow-auto max-h-96">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function Table({ cols, rows }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
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
