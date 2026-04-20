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

      {/* Tabs */}
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

      {/* TAB 0 — Resumen */}
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

      {/* TAB 1 — Stock Bajo */}
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

      {/* TAB 2 — Buscar Producto */}
      {tab === 2 && (
        <SearchPane
          label="SKU o ID del producto"
          placeholder="Ej: PT-VITC-30"
          query={query}
          setQuery={setQuery}
          onSearch={handleSearch}
          loading={loading}
        >
          {searched && result && <ProductStockCard data={result} />}
          {searched && !result && !loading && <EmptyState icon="▦" text="Producto no encontrado" />}
        </SearchPane>
      )}

      {/* TAB 3 — Buscar Lote */}
      {tab === 3 && (
        <SearchPane
          label="LPN del lote"
          placeholder="Ej: PT-VITC-20260225"
          query={query}
          setQuery={setQuery}
          onSearch={handleSearch}
          loading={loading}
        >
          {searched && result && <LotDetailCard data={result} />}
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

// ── Helpers de estado ───────────────────────────────────────────────────────
const HOY = () => { const d = new Date(); d.setHours(0,0,0,0); return d; }

const calcEstado = (row) => {
  const ec = (row.estado_calculado || '').toUpperCase();
  if (ec === 'VENCIDO') return 'VENCIDO';
  const fv = row.expiry_date || row.fecha_venc;
  if (fv && new Date(fv) < HOY()) return 'VENCIDO';
  const st = (row.status || row.estado_calculado || 'DISPONIBLE').toUpperCase();
  return st;
}

const BADGE = {
  VENCIDO:    'bg-red-500/15 text-red-400 border-red-500/30',
  CUARENTENA: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  RECHAZADO:  'bg-orange-500/15 text-orange-400 border-orange-500/30',
  DISPONIBLE: 'bg-green-500/15 text-green-400 border-green-500/30',
}

// ── LotDetailCard ────────────────────────────────────────────────────────────
function LotDetailCard({ data }) {
  const row = data?.data || data;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return <JsonCard data={data} />;
  const estado = calcEstado(row);
  const isVencido    = estado === 'VENCIDO';
  const isCuarentena = estado === 'CUARENTENA';
  const badgeCls = BADGE[estado] ?? 'bg-white/5 text-muted border-border';
  const fv = row.expiry_date || row.fecha_venc;

  const fields = [
    ['LPN',       row.lpn || row.lote || '—'],
    ['Producto',  row.name || row.nombre || '—'],
    ['SKU',       row.sku || row.siigo_code || '—'],
    ['Cantidad',  `${row.qty_current ?? row.cantidad ?? '—'} ${row.unit || row.unit_label || ''}`],
    ['Reservado', row.reservada != null ? row.reservada : '—'],
    ['Bodega',    row.bodega_id ?? '—'],
    ['Origen',    row.origin || '—'],
    ['Vence',     fv ? new Date(fv).toLocaleDateString('es-CO') : 'N/A'],
  ];

  return (
    <div className={`bg-surface border rounded-xl p-4 ${
      isVencido ? 'border-red-500/40' : isCuarentena ? 'border-yellow-500/40' : 'border-border'
    }`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] text-muted mb-0.5 uppercase tracking-wide">Lote</p>
          <p className="font-semibold text-foreground text-sm">{row.lpn || row.lote || '—'}</p>
        </div>
        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border shrink-0 ${badgeCls}`}>
          {estado}
        </span>
      </div>

      {isVencido && (
        <div className="mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
          <span className="text-base leading-none">🚨</span>
          <p className="text-xs text-red-400 font-medium">
            Lote VENCIDO el {new Date(fv).toLocaleDateString('es-CO')} — requiere disposición inmediata
          </p>
        </div>
      )}
      {isCuarentena && (
        <div className="mb-3 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-2">
          <span className="text-base leading-none">⚠️</span>
          <p className="text-xs text-yellow-400 font-medium">
            Lote en CUARENTENA — pendiente análisis y decisión de liberación
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5">
        {fields.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10px] text-muted uppercase tracking-wide mb-0.5">{k}</dt>
            <dd className={`text-xs font-medium ${
              k === 'Vence' && isVencido ? 'text-red-400' : 'text-foreground'
            }`}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── ProductStockCard ─────────────────────────────────────────────────────────
function ProductStockCard({ data }) {
  const rows = data?.data || data;
  if (!Array.isArray(rows)) return <LotDetailCard data={data} />;

  const hoy = HOY();
  const enriched = rows.map(r => ({ ...r, _estado: calcEstado(r) }));
  const totalDisp = enriched.reduce((s, r) =>
    s + parseFloat(r.disponible ?? ((r.cantidad ?? 0) - (r.reservada ?? 0))), 0
  );
  const hasVencidos    = enriched.some(r => r._estado === 'VENCIDO');
  const hasCuarentena  = enriched.some(r => r._estado === 'CUARENTENA');

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold text-foreground">
          {enriched[0]?.name || enriched[0]?.nombre || '—'}
        </p>
        <div className="flex gap-1.5">
          {hasVencidos   && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-red-500/15 text-red-400 border-red-500/30">🚨 Vencido(s)</span>}
          {hasCuarentena && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-yellow-500/15 text-yellow-400 border-yellow-500/30">⚠️ Cuarentena</span>}
        </div>
      </div>
      <p className="text-xs text-muted mb-3">
        Disponible total: <span className="font-bold text-foreground">{totalDisp}</span> und
      </p>

      <div className="space-y-2">
        {enriched.map((r, i) => {
          const isV = r._estado === 'VENCIDO';
          const isCQ = r._estado === 'CUARENTENA';
          const fv = r.fecha_venc || r.expiry_date;
          const badgeCls = BADGE[r._estado] ?? 'bg-white/5 text-muted border-border';
          return (
            <div key={i} className={`p-3 rounded-lg border text-xs ${
              isV  ? 'border-red-500/30 bg-red-500/5' :
              isCQ ? 'border-yellow-500/30 bg-yellow-500/5' :
              'border-border bg-surface'
            }`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-medium text-foreground">{r.lote || r.lpn || '—'}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${badgeCls}`}>
                  {r._estado}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-muted">
                <div>
                  <span className="text-[10px] uppercase tracking-wide block">Cantidad</span>
                  <span className="font-medium text-foreground">{r.cantidad ?? '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wide block">Reservado</span>
                  <span className="font-medium text-foreground">{r.reservada ?? 0}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wide block">Vence</span>
                  <span className={`font-medium ${isV ? 'text-red-400' : 'text-foreground'}`}>
                    {fv ? new Date(fv).toLocaleDateString('es-CO') : 'N/A'}
                  </span>
                </div>
              </div>
              {isV && (
                <p className="mt-1.5 text-[10px] text-red-400 font-medium">
                  🚨 VENCIDO — requiere disposición inmediata
                </p>
              )}
              {isCQ && (
                <p className="mt-1.5 text-[10px] text-yellow-400 font-medium">
                  ⚠️ En cuarentena — pendiente liberación
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
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
