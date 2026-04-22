import { useEffect, useState } from 'react'
import { useInventoryStore } from '../store/inventoryStore'

const TABS = ['Resumen', 'Stock Bajo', 'Buscar Producto', 'Buscar Lote', 'Mapa Bodega']

// ── Mock data – replace with real API call when endpoint is ready ──────────
const MOCK_LOCATIONS = [
  { id: 'A-01-01', zona: 'A', pasillo: '01', nivel: '01', producto: 'RM-TAP-MED', nombre: 'Tapas Medianas', cantidad: 320, unidad: 'und', lote: 'L-2024-101', estado: 'ok' },
  { id: 'A-01-02', zona: 'A', pasillo: '01', nivel: '02', producto: 'RM-TAP-GRD', nombre: 'Tapas Grandes', cantidad: 15, unidad: 'und', lote: 'L-2024-098', estado: 'bajo' },
  { id: 'A-02-01', zona: 'A', pasillo: '02', nivel: '01', producto: 'RM-BOT-250', nombre: 'Botellas 250ml', cantidad: 0, unidad: 'und', lote: null, estado: 'vacio' },
  { id: 'A-02-02', zona: 'A', pasillo: '02', nivel: '02', producto: 'RM-BOT-500', nombre: 'Botellas 500ml', cantidad: 540, unidad: 'und', lote: 'L-2024-110', estado: 'ok' },
  { id: 'A-03-01', zona: 'A', pasillo: '03', nivel: '01', producto: 'RM-ETQ-A4', nombre: 'Etiquetas A4', cantidad: 1200, unidad: 'pliegos', lote: 'L-2024-105', estado: 'ok' },
  { id: 'A-03-02', zona: 'A', pasillo: '03', nivel: '02', producto: null, nombre: null, cantidad: 0, unidad: null, lote: null, estado: 'vacio' },
  { id: 'B-01-01', zona: 'B', pasillo: '01', nivel: '01', producto: 'PT-JUG-NAR', nombre: 'Jugo Naranja 1L', cantidad: 88, unidad: 'cajas', lote: 'L-2024-112', estado: 'ok' },
  { id: 'B-01-02', zona: 'B', pasillo: '01', nivel: '02', producto: 'PT-JUG-MAN', nombre: 'Jugo Mango 1L', cantidad: 22, unidad: 'cajas', lote: 'L-2024-113', estado: 'bajo' },
  { id: 'B-02-01', zona: 'B', pasillo: '02', nivel: '01', producto: 'PT-NEC-DUR', nombre: 'Néctar Durazno', cantidad: 200, unidad: 'cajas', lote: 'L-2024-109', estado: 'ok' },
  { id: 'B-02-02', zona: 'B', pasillo: '02', nivel: '02', producto: 'PT-NEC-GUA', nombre: 'Néctar Guanábana', cantidad: 0, unidad: 'cajas', lote: null, estado: 'vacio' },
  { id: 'B-03-01', zona: 'B', pasillo: '03', nivel: '01', producto: 'PT-JUG-UVA', nombre: 'Jugo Uva 500ml', cantidad: 410, unidad: 'cajas', lote: 'L-2024-115', estado: 'ok' },
  { id: 'B-03-02', zona: 'B', pasillo: '03', nivel: '02', producto: 'PT-JUG-PIA', nombre: 'Jugo Piña 500ml', cantidad: 9, unidad: 'cajas', lote: 'L-2024-116', estado: 'bajo' },
  { id: 'C-01-01', zona: 'C', pasillo: '01', nivel: '01', producto: 'SU-AZU-25K', nombre: 'Azúcar 25kg', cantidad: 60, unidad: 'sacos', lote: 'L-2024-090', estado: 'ok' },
  { id: 'C-01-02', zona: 'C', pasillo: '01', nivel: '02', producto: 'SU-ACU-CAR', nombre: 'Ácido Cítrico', cantidad: 5, unidad: 'kg', lote: 'L-2024-088', estado: 'bajo' },
  { id: 'C-02-01', zona: 'C', pasillo: '02', nivel: '01', producto: null, nombre: null, cantidad: 0, unidad: null, lote: null, estado: 'vacio' },
  { id: 'C-02-02', zona: 'C', pasillo: '02', nivel: '02', producto: 'SU-COL-NAT', nombre: 'Colorante Natural', cantidad: 120, unidad: 'litros', lote: 'L-2024-102', estado: 'ok' },
]

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
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
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

      {tab === 4 && <MapaBodega />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAPA BODEGA
// ─────────────────────────────────────────────────────────────────────────────
function MapaBodega() {
  const [locations] = useState(MOCK_LOCATIONS)
  const [selected, setSelected] = useState(null)
  const [filterZona, setFilterZona] = useState('todas')
  const [filterEstado, setFilterEstado] = useState('todos')

  const zonas = ['todas', ...Array.from(new Set(locations.map(l => l.zona)))]

  const filtered = locations.filter(l => {
    const zonaOk = filterZona === 'todas' || l.zona === filterZona
    const estadoOk = filterEstado === 'todos' || l.estado === filterEstado
    return zonaOk && estadoOk
  })

  // Group by zona → pasillo
  const grouped = filtered.reduce((acc, loc) => {
    if (!acc[loc.zona]) acc[loc.zona] = {}
    if (!acc[loc.zona][loc.pasillo]) acc[loc.zona][loc.pasillo] = []
    acc[loc.zona][loc.pasillo].push(loc)
    return acc
  }, {})

  const estadoConfig = {
    ok:    { bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', dot: 'bg-emerald-400', label: 'Con stock' },
    bajo:  { bg: 'bg-amber-500/20',   border: 'border-amber-500/40',   dot: 'bg-amber-400',   label: 'Stock bajo' },
    vacio: { bg: 'bg-zinc-500/10',    border: 'border-zinc-600/30',    dot: 'bg-zinc-500',    label: 'Vacío' },
  }

  const totals = {
    ok:    locations.filter(l => l.estado === 'ok').length,
    bajo:  locations.filter(l => l.estado === 'bajo').length,
    vacio: locations.filter(l => l.estado === 'vacio').length,
  }

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="grid grid-cols-3 gap-3">
        {Object.entries(estadoConfig).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setFilterEstado(filterEstado === key ? 'todos' : key)}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all text-left ${
              filterEstado === key
                ? `${cfg.bg} ${cfg.border} ring-1 ring-inset ring-current`
                : 'bg-surface border-border hover:border-primary/40'
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
            <div>
              <p className="text-lg font-bold tabular-nums text-foreground">{totals[key]}</p>
              <p className="text-xs text-muted">{cfg.label}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <span className="text-xs text-muted self-center">Zona:</span>
        {zonas.map(z => (
          <button
            key={z}
            onClick={() => setFilterZona(z)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${
              filterZona === z
                ? 'bg-primary text-white border-primary'
                : 'bg-surface border-border text-muted hover:text-foreground'
            }`}
          >
            {z === 'todas' ? 'Todas' : `Zona ${z}`}
          </button>
        ))}
      </div>

      {/* Warehouse grid */}
      <div className="space-y-6">
        {Object.entries(grouped).map(([zona, pasillos]) => (
          <div key={zona}>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 rounded bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary">{zona}</span>
              <h3 className="text-sm font-semibold text-foreground">Zona {zona}</h3>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted">{Object.values(pasillos).flat().length} ubicaciones</span>
            </div>

            <div className="space-y-3">
              {Object.entries(pasillos).map(([pasillo, locs]) => (
                <div key={pasillo}>
                  <p className="text-xs text-muted mb-1.5 ml-1">Pasillo {pasillo}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {locs.map(loc => {
                      const cfg = estadoConfig[loc.estado]
                      const isSelected = selected?.id === loc.id
                      return (
                        <button
                          key={loc.id}
                          onClick={() => setSelected(isSelected ? null : loc)}
                          className={`relative p-3 rounded-lg border text-left transition-all hover:scale-[1.02] active:scale-[0.98] ${cfg.bg} ${cfg.border} ${
                            isSelected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''
                          }`}
                        >
                          <span className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                          <p className="text-xs font-bold text-foreground mb-1">{loc.id}</p>
                          {loc.producto ? (
                            <>
                              <p className="text-[10px] text-muted truncate leading-tight">{loc.nombre}</p>
                              <p className="text-sm font-semibold tabular-nums text-foreground mt-1">
                                {loc.cantidad.toLocaleString()}
                                <span className="text-[10px] text-muted ml-0.5">{loc.unidad}</span>
                              </p>
                            </>
                          ) : (
                            <p className="text-[10px] text-muted mt-1">Vacío</p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {Object.keys(grouped).length === 0 && (
          <EmptyState icon="▦" text="No hay ubicaciones con ese filtro" />
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm mx-auto px-4">
          <div className="bg-surface border border-border rounded-xl shadow-2xl p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted">Ubicación</p>
                <p className="text-base font-bold text-foreground">{selected.id}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-muted hover:text-foreground transition-colors text-lg leading-none"
              >
                ×
              </button>
            </div>
            {selected.producto ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <InfoRow label="SKU" value={selected.producto} />
                <InfoRow label="Producto" value={selected.nombre} />
                <InfoRow label="Cantidad" value={`${selected.cantidad.toLocaleString()} ${selected.unidad}`} highlight />
                <InfoRow label="Lote" value={selected.lote || '—'} />
                <InfoRow label="Zona" value={`Zona ${selected.zona}`} />
                <InfoRow label="Estado" value={estadoConfig[selected.estado].label} />
              </div>
            ) : (
              <p className="text-sm text-muted">Ubicación sin producto asignado</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value, highlight }) {
  return (
    <div className="bg-background/50 rounded-lg px-3 py-2">
      <p className="text-[10px] text-muted mb-0.5">{label}</p>
      <p className={`text-sm font-medium truncate ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
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
