import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useInventoryStore }  from '../store/inventoryStore'
import { useApprovalsStore }  from '../store/approvalsStore'
import { useProductionStore } from '../store/productionStore'
import { useWasteStore }      from '../store/wasteStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const n = (v, decimals = 0) =>
  v != null ? Number(v).toLocaleString('es-CO', { maximumFractionDigits: decimals }) : '—'

// ─── SVG Icons ────────────────────────────────────────────────────────────────
const Icons = {
  Truck: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/>
      <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
    </svg>
  ),
  Warehouse: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-6 9 6v11a1 1 0 01-1 1H4a1 1 0 01-1-1z"/>
      <path d="M9 22V12h6v10"/>
    </svg>
  ),
  Package: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  ),
  Gear: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  ),
  Dispatch: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
      <path d="M3 6h3M3 12h2M3 18h3"/>
    </svg>
  ),
  Alert: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  Arrow: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
}

// ─── Componente: Zona del plano ───────────────────────────────────────────────
function Zone({ icon: Icon, title, subtitle, color, accent, stats, href, alert, loading, style }) {
  return (
    <Link to={href} className="group relative flex flex-col min-w-0 rounded-xl border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{
        background: `linear-gradient(135deg, ${color}18 0%, ${color}08 100%)`,
        borderColor: alert ? '#f85149' : `${color}35`,
        boxShadow: alert ? `0 0 0 1px #f8514930` : 'none',
        ...style,
      }}>

      {/* Alert pulse */}
      {alert && (
        <span className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-danger"
          style={{ animation: 'pulse 1.5s ease-in-out infinite' }}/>
      )}

      {/* Header zona */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110"
          style={{ background: `${color}25`, color }}>
          <div className="w-5 h-5"><Icon /></div>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight truncate">{title}</p>
          <p className="text-[10px] text-muted mt-0.5 leading-tight">{subtitle}</p>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px" style={{ background: `${color}20` }} />

      {/* Stats */}
      <div className="px-4 py-3 flex-1 space-y-2">
        {loading ? (
          <div className="space-y-2">
            {[1,2].map(i => (
              <div key={i} className="h-8 rounded-lg bg-white/5 animate-pulse"/>
            ))}
          </div>
        ) : stats.map((s, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted leading-none truncate">{s.label}</span>
            <span className="text-sm font-bold tabular-nums shrink-0 leading-none"
              style={{ color: s.danger ? '#f85149' : s.warn ? '#e3b341' : color }}>
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {/* Footer hover indicator */}
      <div className="px-4 pb-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <span className="text-[10px] font-medium" style={{ color }}>Ver detalle</span>
        <div className="w-3 h-3" style={{ color }}><Icons.Arrow /></div>
      </div>
    </Link>
  )
}

// ─── Componente: Conector entre zonas ────────────────────────────────────────
function FlowArrow({ label }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 shrink-0 px-1">
      <div className="w-8 h-px bg-border relative">
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0"
          style={{ borderLeft: '6px solid #30363d', borderTop: '4px solid transparent', borderBottom: '4px solid transparent' }}/>
      </div>
      {label && <span className="text-[9px] text-muted uppercase tracking-widest whitespace-nowrap">{label}</span>}
    </div>
  )
}

// ─── Dashboard principal ──────────────────────────────────────────────────────
export default function DashboardPage() {
  const { summary, lowStock, loading: invLoading, fetchSummary, fetchLowStock } = useInventoryStore()
  const { list: pendingList, loading: apLoading, fetchList: fetchApprovals }    = useApprovalsStore()
  const { list: prodList,    loading: prodLoading, fetchList: fetchProd }       = useProductionStore()
  const { list: wasteList,   loading: wasteLoading, fetchList: fetchWaste }     = useWasteStore()

  useEffect(() => {
    fetchSummary()
    fetchLowStock()
    fetchApprovals()
    fetchProd({ status: 'en_proceso' })
    fetchWaste({ limit: 50 })
  }, [])

  // ── KPIs derivados ─────────────────────────────────────────────────────────
  const totalProducts = Array.isArray(summary) ? summary.length : 0
  const totalStock    = Array.isArray(summary)
    ? summary.reduce((a, p) => a + (p.stock?.disponible_neto ?? 0), 0) : 0

  const prodActivas   = prodList.filter(o => ['en_proceso','pendiente'].includes(o.status)).length
  const prodHoy       = prodList.length

  const wasteTotalKg  = wasteList.reduce((a, w) => a + (Number(w.qty) || 0), 0)
  const wasteHoy      = wasteList.filter(w => {
    const d = new Date(w.created_at || w.createdAt)
    return d.toDateString() === new Date().toDateString()
  }).length

  const now = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })

  // ── Zonas del plano ────────────────────────────────────────────────────────
  const zones = [
    {
      icon:     Icons.Truck,
      title:    'Recepción',
      subtitle: 'Entrada de mercancía',
      color:    '#58a6ff',
      href:     '/recepciones',
      loading:  apLoading,
      alert:    pendingList.length > 0,
      stats: [
        { label: 'Pendientes aprobación', value: apLoading ? '…' : pendingList.length, warn: pendingList.length > 0 },
        { label: 'Stock total disponible', value: invLoading ? '…' : n(totalStock) + ' u.' },
      ],
    },
    {
      icon:     Icons.Warehouse,
      title:    'Almacenamiento',
      subtitle: 'Inventario en bodega',
      color:    '#3fb950',
      href:     '/inventario',
      loading:  invLoading,
      alert:    lowStock.length > 0,
      stats: [
        { label: 'Productos activos',  value: invLoading ? '…' : n(totalProducts) },
        { label: 'Bajo mínimo',        value: invLoading ? '…' : lowStock.length, danger: lowStock.length > 0 },
      ],
    },
    {
      icon:     Icons.Gear,
      title:    'Producción',
      subtitle: 'Órdenes de fabricación',
      color:    '#f0883e',
      href:     '/produccion',
      loading:  prodLoading,
      alert:    false,
      stats: [
        { label: 'Órdenes activas',  value: prodLoading ? '…' : n(prodActivas) },
        { label: 'Cargadas hoy',     value: prodLoading ? '…' : n(prodHoy) },
      ],
    },
    {
      icon:     Icons.Alert,
      title:    'Mermas',
      subtitle: 'Pérdidas registradas',
      color:    '#f85149',
      href:     '/mermas',
      loading:  wasteLoading,
      alert:    wasteHoy > 0,
      stats: [
        { label: 'Registros hoy',   value: wasteLoading ? '…' : n(wasteHoy), danger: wasteHoy > 0 },
        { label: 'Total acumulado', value: wasteLoading ? '…' : n(wasteTotalKg, 1) + ' u.' },
      ],
    },
    {
      icon:     Icons.Dispatch,
      title:    'Despachos',
      subtitle: 'Salida de mercancía',
      color:    '#a371f7',
      href:     '/despachos',
      loading:  false,
      alert:    false,
      stats: [
        { label: 'Kardex actualizado', value: 'Ver →' },
        { label: 'Aprobaciones',       value: apLoading ? '…' : pendingList.length, warn: pendingList.length > 0 },
      ],
    },
  ]

  return (
    <div className="flex flex-col gap-6 h-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground leading-none">Plano de operaciones</h1>
          <p className="text-xs text-muted mt-1">Flujo de bodega en tiempo real · Actualizado {now}</p>
        </div>
        <div className="flex items-center gap-2">
          {lowStock.length > 0 && (
            <Link to="/inventario"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-danger/30 bg-danger/8 text-danger hover:bg-danger/15 transition-colors">
              <div className="w-3.5 h-3.5"><Icons.Alert /></div>
              {lowStock.length} bajo mínimo
            </Link>
          )}
          {pendingList.length > 0 && (
            <Link to="/aprobaciones"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-yellow-500/30 bg-yellow-500/8 text-yellow-400 hover:bg-yellow-500/15 transition-colors">
              <div className="w-3.5 h-3.5"><Icons.Check /></div>
              {pendingList.length} aprobaciones
            </Link>
          )}
        </div>
      </div>

      {/* ── Plano: flujo horizontal ── */}
      <div className="flex items-stretch gap-0 overflow-x-auto"
        style={{ minHeight: '280px' }}>
        {zones.map((zone, i) => (
          <div key={zone.title} className="flex items-center gap-0 min-w-0" style={{ flex: '1 1 0' }}>
            <Zone {...zone} style={{ flex: 1, minWidth: '140px' }} />
            {i < zones.length - 1 && <FlowArrow label={i === 1 ? 'procesa' : i === 2 ? 'descarta' : ''} />}
          </div>
        ))}
      </div>

      {/* ── Sección inferior: alertas + estado ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1">

        {/* Alertas stock bajo */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 text-danger"><Icons.Alert /></div>
              <p className="text-sm font-semibold text-foreground">Alertas de stock</p>
              {lowStock.length > 0 && (
                <span className="text-[10px] font-bold bg-danger/15 text-danger px-2 py-0.5 rounded-full">
                  {lowStock.length}
                </span>
              )}
            </div>
            <Link to="/inventario" className="text-xs text-primary hover:underline">Ver todo →</Link>
          </div>

          {invLoading ? (
            <div className="p-4 space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse"/>)}
            </div>
          ) : lowStock.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <div className="w-8 h-8 text-green-400"><Icons.Check /></div>
              <p className="text-sm font-medium text-foreground">Sin alertas de stock</p>
              <p className="text-xs text-muted">Todos los productos sobre el mínimo</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {lowStock.slice(0, 5).map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-white/3 transition-colors">
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-primary truncate">{item.product?.sku || item.sku}</p>
                    <p className="text-[11px] text-muted truncate">{item.product?.name || item.name}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular-nums text-danger">
                      {item.disponible_neto ?? item.stock_actual} {item.product?.unit || item.unit}
                    </p>
                    <p className="text-[10px] text-muted">mín {item.min_stock}</p>
                  </div>
                </div>
              ))}
              {lowStock.length > 5 && (
                <div className="px-4 py-2 text-center">
                  <Link to="/inventario" className="text-xs text-primary hover:underline">
                    +{lowStock.length - 5} más →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Aprobaciones + Producción activa */}
        <div className="flex flex-col gap-4">

          {/* Aprobaciones pendientes */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden flex-1">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 text-yellow-400"><Icons.Check /></div>
                <p className="text-sm font-semibold text-foreground">Aprobaciones pendientes</p>
                {pendingList.length > 0 && (
                  <span className="text-[10px] font-bold bg-yellow-400/15 text-yellow-400 px-2 py-0.5 rounded-full">
                    {pendingList.length}
                  </span>
                )}
              </div>
              <Link to="/aprobaciones" className="text-xs text-primary hover:underline">Gestionar →</Link>
            </div>

            {apLoading ? (
              <div className="p-4 space-y-2">
                {[1,2].map(i => <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse"/>)}
              </div>
            ) : pendingList.length === 0 ? (
              <div className="flex items-center justify-center py-6 gap-2">
                <div className="w-4 h-4 text-green-400"><Icons.Check /></div>
                <p className="text-sm text-muted">Sin aprobaciones pendientes</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {pendingList.slice(0, 3).map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-white/3 transition-colors">
                    <div className="min-w-0">
                      <p className="text-xs text-foreground truncate">{item.description || `Solicitud #${item.id?.slice(0,8)}`}</p>
                      {item.from_phone && <p className="text-[11px] text-muted">📱 {item.from_phone}</p>}
                    </div>
                    <span className="text-[10px] font-medium bg-yellow-400/10 text-yellow-400 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">
                      {item.type?.replace(/_/g,' ')}
                    </span>
                  </div>
                ))}
                {pendingList.length > 3 && (
                  <div className="px-4 py-2 text-center">
                    <Link to="/aprobaciones" className="text-xs text-primary hover:underline">
                      +{pendingList.length - 3} más →
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Producción activa — mini chips */}
          <div className="bg-surface border border-border rounded-xl px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 text-primary"><Icons.Gear /></div>
                <p className="text-sm font-semibold text-foreground">Producción activa</p>
              </div>
              <Link to="/produccion" className="text-xs text-primary hover:underline">Ver todo →</Link>
            </div>
            {prodLoading ? (
              <div className="flex gap-2 flex-wrap">
                {[1,2,3].map(i => <div key={i} className="h-7 w-24 rounded-full bg-white/5 animate-pulse"/>)}
              </div>
            ) : prodActivas === 0 ? (
              <p className="text-xs text-muted">Sin órdenes activas en este momento</p>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {prodList.filter(o => ['en_proceso','pendiente'].includes(o.status)).slice(0, 6).map(o => (
                  <span key={o.id}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border"
                    style={{
                      background: o.status === 'en_proceso' ? '#f0883e15' : '#58a6ff15',
                      borderColor: o.status === 'en_proceso' ? '#f0883e40' : '#58a6ff40',
                      color: o.status === 'en_proceso' ? '#f0883e' : '#58a6ff',
                    }}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: 'currentColor', animation: o.status === 'en_proceso' ? 'pulse 2s infinite' : 'none' }}/>
                    {o.sku || o.product_name?.slice(0, 12) || o.codigo_orden}
                  </span>
                ))}
                {prodActivas > 6 && (
                  <span className="text-[11px] text-muted self-center">+{prodActivas - 6} más</span>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
