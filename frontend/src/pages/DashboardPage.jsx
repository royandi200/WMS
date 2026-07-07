import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Factory,
  PackageCheck,
  Radio,
  RefreshCw,
  ShieldCheck,
  Truck,
  Warehouse,
  Trash2,
  Zap,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useInventoryStore } from '../store/inventoryStore'
import { useApprovalsStore } from '../store/approvalsStore'
import { useProductionStore } from '../store/productionStore'
import { useWasteStore } from '../store/wasteStore'
import { useReceptionStore } from '../store/receptionStore'
import { useDispatchStore } from '../store/dispatchStore'

const PERIODS = [
  { key: 'today', label: 'Hoy' },
  { key: 'week', label: '7 dias' },
  { key: 'month', label: '30 dias' },
]

const STATUS_LABEL = {
  PLANEADA: 'Planeadas',
  APROBADA: 'Aprobadas',
  EN_PROCESO: 'En proceso',
  CERRADA: 'Cerradas',
  CANCELADA: 'Canceladas',
}

const APPROVAL_LABEL = {
  SOLICITAR_INICIO_PRODUCCION: 'Inicio produccion',
  SOLICITAR_CIERRE_PRODUCCION: 'Cierre produccion',
  SOLICITAR_DESPACHO: 'Despacho',
  REPORTAR_MERMA: 'Merma',
  REPORTE_MERMA: 'Merma',
  INGRESO_RECEPCION: 'Recepcion',
}

function periodStart(period) {
  const d = new Date()
  if (period === 'today') {
    d.setHours(0, 0, 0, 0)
    return d
  }
  d.setDate(d.getDate() - (period === 'week' ? 7 : 30))
  d.setHours(0, 0, 0, 0)
  return d
}

function fmtN(value, decimals = 0) {
  if (value == null || Number.isNaN(Number(value))) return '-'
  return Number(value).toLocaleString('es-CO', { maximumFractionDigits: decimals })
}

function toDate(value) {
  const d = value ? new Date(value) : null
  return d && !Number.isNaN(d.getTime()) ? d : null
}

function inPeriod(value, period) {
  const d = toDate(value)
  return d ? d >= periodStart(period) : false
}

function hoursSince(value) {
  const d = toDate(value)
  if (!d) return null
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 36e5))
}

function sum(rows, selector) {
  return rows.reduce((acc, row) => acc + Math.abs(Number(selector(row) || 0)), 0)
}

function groupCount(rows, selector) {
  return rows.reduce((acc, row) => {
    const key = selector(row) || 'SIN_DATO'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

function SpinnerBlock({ rows = 3 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 rounded-lg bg-white/5 animate-pulse" />
      ))}
    </div>
  )
}

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.max(4, Math.min(100, (Number(value || 0) / max) * 100)) : 0
  return (
    <div className="h-1.5 rounded-full bg-border/70 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

function PeriodTabs({ period, setPeriod }) {
  return (
    <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          onClick={() => setPeriod(p.key)}
          className="text-xs px-3 py-1 rounded-md transition-colors"
          style={{
            background: period === p.key ? '#f0883e22' : 'transparent',
            color: period === p.key ? '#f0883e' : '#8b949e',
            fontWeight: period === p.key ? 700 : 500,
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

function StageCard({
  icon: Icon,
  title,
  subtitle,
  color,
  href,
  primary,
  primaryLabel,
  metrics,
  footer,
  alert,
  loading,
}) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate(href)}
      className="group text-left bg-surface border border-border rounded-xl p-4 min-w-[220px] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{
        boxShadow: alert ? `0 0 0 1px ${color}28` : undefined,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `${color}70`
        e.currentTarget.style.boxShadow = `0 0 0 1px ${color}25, 0 12px 30px ${color}12`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = ''
        e.currentTarget.style.boxShadow = alert ? `0 0 0 1px ${color}28` : ''
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
            <Icon size={20} style={{ color }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{title}</p>
            <p className="text-[11px] text-muted truncate">{subtitle}</p>
          </div>
        </div>
        {alert && <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: color }} />}
      </div>

      {loading ? (
        <div className="mt-4"><SpinnerBlock rows={2} /></div>
      ) : (
        <>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-foreground">{primary}</span>
            <span className="text-xs text-muted">{primaryLabel}</span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {metrics.map((m) => (
              <div key={m.label} className="rounded-lg border border-border/70 bg-background/30 px-3 py-2">
                <p className="text-[10px] text-muted truncate">{m.label}</p>
                <p className="text-sm font-semibold tabular-nums truncate" style={{ color: m.color || '#e6edf3' }}>
                  {m.value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted truncate">{footer}</p>
            <ArrowRight size={13} className="text-muted group-hover:text-primary transition-colors shrink-0" />
          </div>
        </>
      )}
    </button>
  )
}

function Section({ icon: Icon, title, action, children }) {
  return (
    <section className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={14} className="text-primary shrink-0" />
          <h2 className="text-sm font-semibold text-foreground truncate">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function ExceptionRow({ severity = 'media', title, detail, to }) {
  const navigate = useNavigate()
  const color = severity === 'alta' ? '#f85149' : severity === 'media' ? '#e3b341' : '#58a6ff'
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="w-full flex items-center gap-3 py-2.5 border-b border-border/40 last:border-b-0 text-left hover:bg-white/[0.03] transition-colors"
    >
      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground truncate">{title}</p>
        <p className="text-[11px] text-muted truncate">{detail}</p>
      </div>
      <ArrowRight size={12} className="text-muted shrink-0" />
    </button>
  )
}

function RecentRow({ title, detail, amount, color }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-b-0">
      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground truncate">{title}</p>
        <p className="text-[11px] text-muted truncate">{detail}</p>
      </div>
      <span className="text-xs font-semibold tabular-nums text-muted shrink-0">{amount}</span>
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const {
    summary,
    lowStock,
    kardex,
    loadingSummary,
    loadingKardex,
    loadingLowStock,
    fetchSummary,
    fetchLowStock,
    fetchKardex,
  } = useInventoryStore()
  const {
    pendingList,
    loadingPending,
    fetchPending,
  } = useApprovalsStore()
  const {
    list: productionList,
    loading: productionLoading,
    fetchList: fetchProduction,
  } = useProductionStore()
  const {
    list: wasteList,
    loading: wasteLoading,
    fetchList: fetchWaste,
  } = useWasteStore()
  const {
    list: receptionList,
    loading: receptionLoading,
    fetchList: fetchReceptions,
  } = useReceptionStore()
  const {
    list: dispatchList,
    loading: dispatchLoading,
    fetchList: fetchDispatches,
  } = useDispatchStore()

  const [period, setPeriod] = useState('week')
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(Date.now())

  const loadAll = useCallback(async () => {
    await Promise.all([
      fetchSummary(),
      fetchLowStock(),
      fetchKardex({ limit: 200, page: 1 }),
      fetchPending({ limit: 50 }),
      fetchProduction({ limit: 100 }).catch(() => {}),
      fetchWaste({ limit: 100 }).catch(() => {}),
      fetchReceptions({ limit: 100 }).catch(() => {}),
      fetchDispatches({ limit: 100 }).catch(() => {}),
    ])
    setLastUpdate(Date.now())
  }, [
    fetchSummary,
    fetchLowStock,
    fetchKardex,
    fetchPending,
    fetchProduction,
    fetchWaste,
    fetchReceptions,
    fetchDispatches,
  ])

  useEffect(() => {
    loadAll()
    const id = window.setInterval(loadAll, 30000)
    return () => window.clearInterval(id)
  }, [loadAll])

  const refresh = async () => {
    setRefreshing(true)
    await loadAll()
    setRefreshing(false)
  }

  const safeKardex = Array.isArray(kardex) ? kardex : []
  const safeLowStock = Array.isArray(lowStock) ? lowStock : []
  const safeApprovals = Array.isArray(pendingList) ? pendingList : []
  const safeProductions = Array.isArray(productionList) ? productionList : []
  const safeWaste = Array.isArray(wasteList) ? wasteList : []
  const safeReceptions = Array.isArray(receptionList) ? receptionList : []
  const safeDispatches = Array.isArray(dispatchList) ? dispatchList : []

  const periodLabel = PERIODS.find((p) => p.key === period)?.label || 'Periodo'
  const scopedReceptions = useMemo(
    () => safeReceptions.filter((r) => inPeriod(r.completado_en || r.creado_en, period)),
    [safeReceptions, period]
  )
  const scopedDispatches = useMemo(
    () => safeDispatches.filter((r) => inPeriod(r.despachado_en || r.creado_en, period)),
    [safeDispatches, period]
  )
  const scopedWaste = useMemo(
    () => safeWaste.filter((r) => inPeriod(r.created_at || r.creado_en, period)),
    [safeWaste, period]
  )
  const scopedKardex = useMemo(
    () => safeKardex.filter((r) => inPeriod(r.fecha || r.created_at, period)),
    [safeKardex, period]
  )

  const productionByStatus = useMemo(
    () => groupCount(safeProductions, (o) => String(o.status || o.estado || '').toUpperCase()),
    [safeProductions]
  )
  const activeProductions =
    (productionByStatus.EN_PROCESO || 0) +
    (productionByStatus.APROBADA || 0) +
    (productionByStatus.PLANEADA || 0)
  const closedInPeriod = safeProductions.filter((o) => inPeriod(o.cerrado_en || o.closed_at, period)).length

  const approvalByType = useMemo(
    () => groupCount(safeApprovals, (a) => a.accion || a.tipo || a.type),
    [safeApprovals]
  )
  const oldestApprovalHours = safeApprovals.reduce((max, a) => {
    const h = hoursSince(a.creado_en || a.created_at)
    return h == null ? max : Math.max(max, h)
  }, 0)

  const totalStock = Number(summary?.disponible ?? summary?.total_unidades ?? 0)
  const reservedStock = Number(summary?.reservado ?? 0)
  const expiringLots = Number(summary?.vencimientos_proximos ?? 0)
  const stockAlerts = Number(summary?.bajo_stock ?? safeLowStock.length)
  const receptionUnits = sum(scopedReceptions, (r) => r.cantidad_rec)
  const damagedUnits = sum(scopedReceptions, (r) => Number(r.cantidad_esp || 0) - Number(r.cantidad_rec || 0))
  const dispatchUnits = sum(scopedDispatches, (r) => r.cantidad)
  const wasteUnits = sum(scopedWaste, (r) => r.qty ?? r.cantidad)
  const entryUnits = sum(scopedKardex.filter((r) => r.tipo === 'entrada'), (r) => r.cantidad)
  const exitUnits = sum(scopedKardex.filter((r) => r.tipo === 'salida'), (r) => r.cantidad)

  const maxFlow = Math.max(entryUnits, exitUnits, wasteUnits, 1)

  const exceptions = [
    ...safeLowStock.slice(0, 3).map((item) => ({
      severity: Number(item.disponible ?? item.stock ?? 0) <= Number(item.min_stock ?? 0) * 0.35 ? 'alta' : 'media',
      title: `${item.sku || item.iditem || 'SKU'} bajo minimo`,
      detail: `${item.name || item.nombre || 'Producto'}: ${fmtN(item.disponible ?? item.stock)} / min ${fmtN(item.min_stock)}`,
      to: '/inventario',
    })),
    ...(safeApprovals.length ? [{
      severity: oldestApprovalHours >= 6 ? 'alta' : 'media',
      title: `${safeApprovals.length} aprobaciones pendientes`,
      detail: oldestApprovalHours ? `Mas antigua: ${oldestApprovalHours} h` : 'Requieren decision del supervisor',
      to: '/aprobaciones',
    }] : []),
    ...(expiringLots ? [{
      severity: 'media',
      title: `${expiringLots} lotes proximos a vencer`,
      detail: 'Revisar FEFO, cuarentena o disposicion',
      to: '/inventario',
    }] : []),
    ...(scopedWaste.length ? [{
      severity: 'media',
      title: `${fmtN(wasteUnits, 1)} u. en mermas`,
      detail: `${scopedWaste.length} registros en ${periodLabel.toLowerCase()}`,
      to: '/mermas',
    }] : []),
  ].slice(0, 6)

  const recentEvents = [
    ...scopedReceptions.slice(0, 4).map((r) => ({
      title: r.numero || 'Recepcion',
      detail: `${r.sku || '-'} - ${r.proveedor_nombre || 'Proveedor N/A'}`,
      amount: `+${fmtN(r.cantidad_rec)} u`,
      color: '#3fb950',
      date: toDate(r.completado_en || r.creado_en)?.getTime() || 0,
    })),
    ...scopedDispatches.slice(0, 4).map((r) => ({
      title: r.numero || 'Despacho',
      detail: `${r.sku || '-'} - ${r.cliente_nombre || 'Cliente N/A'}`,
      amount: `-${fmtN(r.cantidad)} u`,
      color: '#f0883e',
      date: toDate(r.despachado_en || r.creado_en)?.getTime() || 0,
    })),
    ...scopedWaste.slice(0, 4).map((r) => ({
      title: r.numero || 'Merma',
      detail: `${r.sku || '-'} - ${r.reason || r.motivo || 'Sin motivo'}`,
      amount: `-${fmtN(r.qty ?? r.cantidad)} u`,
      color: '#f85149',
      date: toDate(r.created_at || r.creado_en)?.getTime() || 0,
    })),
  ].sort((a, b) => b.date - a.date).slice(0, 8)

  const isLoadingCore = loadingSummary || loadingKardex || loadingLowStock
  const greetingHour = new Date().getHours()
  const greeting = greetingHour < 12 ? 'Buenos dias' : greetingHour < 18 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div className="px-4 md:px-6 py-5 space-y-5">
      <style>{`
        @keyframes liveDot { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes flowLine { 0%{transform:translateX(-100%);opacity:0} 50%{opacity:1} 100%{transform:translateX(260%);opacity:0} }
      `}</style>

      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Zap size={15} className="text-primary" />
            <h1 className="text-lg font-semibold text-foreground">{greeting}, {user?.nombre?.split(' ')[0] || 'Admin'}</h1>
          </div>
          <p className="text-xs text-muted mt-1">
            {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-[11px] text-muted px-2 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ animation: 'liveDot 2s infinite' }} />
            <span>actualizado {Math.max(0, Math.floor((Date.now() - lastUpdate) / 1000))}s</span>
          </div>
          <PeriodTabs period={period} setPeriod={setPeriod} />
          <button
            type="button"
            onClick={refresh}
            className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-foreground hover:border-primary/50 transition-colors"
            title="Actualizar"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <section className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck size={15} className="text-primary shrink-0" />
            <h2 className="text-sm font-semibold text-foreground truncate">Plano de operaciones</h2>
            <span className="text-[9px] text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0.5 rounded-full font-semibold">LIVE</span>
          </div>
          <div className="hidden sm:flex items-center gap-1 text-[11px] text-muted">
            <Radio size={12} className="text-emerald-400" />
            En tiempo real
          </div>
        </div>

        <div className="p-4 overflow-x-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 min-w-0">
            <StageCard
              icon={Truck}
              title="Recepciones"
              subtitle="Entrada y calidad"
              color="#58a6ff"
              href="/recepciones"
              primary={fmtN(scopedReceptions.length)}
              primaryLabel={`rec. ${periodLabel.toLowerCase()}`}
              loading={receptionLoading}
              alert={damagedUnits > 0}
              metrics={[
                { label: 'Unidades recibidas', value: fmtN(receptionUnits) },
                { label: 'Daniadas', value: fmtN(damagedUnits), color: damagedUnits ? '#f85149' : '#8b949e' },
              ]}
              footer={scopedReceptions[0]?.numero ? `Ultima: ${scopedReceptions[0].numero}` : 'Sin recepciones en periodo'}
            />
            <StageCard
              icon={Warehouse}
              title="Almacen"
              subtitle="Stock, reserva y riesgo"
              color="#3fb950"
              href="/inventario"
              primary={fmtN(totalStock)}
              primaryLabel="u. disponibles"
              loading={isLoadingCore}
              alert={stockAlerts > 0 || expiringLots > 0}
              metrics={[
                { label: 'Reservado', value: fmtN(reservedStock) },
                { label: 'Bajo minimo', value: fmtN(stockAlerts), color: stockAlerts ? '#f85149' : '#8b949e' },
              ]}
              footer={expiringLots ? `${expiringLots} lotes proximos a vencer` : 'Sin vencimientos criticos'}
            />
            <StageCard
              icon={Factory}
              title="Produccion"
              subtitle="Ordenes y cierre"
              color="#f0883e"
              href="/produccion"
              primary={fmtN(activeProductions)}
              primaryLabel="ordenes activas"
              loading={productionLoading}
              alert={(productionByStatus.EN_PROCESO || 0) > 0}
              metrics={[
                { label: 'En proceso', value: fmtN(productionByStatus.EN_PROCESO || 0), color: '#f0883e' },
                { label: 'Cerradas', value: fmtN(closedInPeriod), color: '#3fb950' },
              ]}
              footer={`${fmtN(productionByStatus.APROBADA || 0)} aprobadas, ${fmtN(productionByStatus.PLANEADA || 0)} planeadas`}
            />
            <StageCard
              icon={Trash2}
              title="Mermas"
              subtitle="Perdidas y causa raiz"
              color="#f85149"
              href="/mermas"
              primary={fmtN(wasteUnits, 1)}
              primaryLabel={`u. ${periodLabel.toLowerCase()}`}
              loading={wasteLoading}
              alert={wasteUnits > 0}
              metrics={[
                { label: 'Registros', value: fmtN(scopedWaste.length) },
                { label: 'Ordenes afectadas', value: fmtN(new Set(scopedWaste.map((w) => w.production_order_code || w.production_order_id).filter(Boolean)).size) },
              ]}
              footer={scopedWaste[0]?.reason ? `Ultimo motivo: ${scopedWaste[0].reason}` : 'Sin mermas en periodo'}
            />
            <StageCard
              icon={ClipboardList}
              title="Aprobaciones"
              subtitle="Bloqueos operativos"
              color="#d2a8ff"
              href="/aprobaciones"
              primary={fmtN(safeApprovals.length)}
              primaryLabel="pendientes"
              loading={loadingPending}
              alert={safeApprovals.length > 0}
              metrics={[
                { label: 'Mas antigua', value: oldestApprovalHours ? `${oldestApprovalHours} h` : '-' },
                { label: 'Produccion', value: fmtN((approvalByType.SOLICITAR_INICIO_PRODUCCION || 0) + (approvalByType.SOLICITAR_CIERRE_PRODUCCION || 0)) },
              ]}
              footer={safeApprovals[0]?.codigo_solicitud ? `Siguiente: ${safeApprovals[0].codigo_solicitud}` : 'Sin aprobaciones pendientes'}
            />
          </div>

          <div className="mt-5 pt-4 border-t border-border/50 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-[10px] text-muted uppercase">Entradas</p>
              <p className="text-sm font-semibold text-foreground">{fmtN(entryUnits)} u.</p>
              <MiniBar value={entryUnits} max={maxFlow} color="#3fb950" />
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase">Salidas</p>
              <p className="text-sm font-semibold text-foreground">{fmtN(exitUnits || dispatchUnits)} u.</p>
              <MiniBar value={exitUnits || dispatchUnits} max={maxFlow} color="#f0883e" />
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase">Mermas</p>
              <p className="text-sm font-semibold text-foreground">{fmtN(wasteUnits, 1)} u.</p>
              <MiniBar value={wasteUnits} max={maxFlow} color="#f85149" />
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase">Pendientes</p>
              <p className="text-sm font-semibold text-foreground">{fmtN(safeApprovals.length)} aprobaciones</p>
              <MiniBar value={safeApprovals.length} max={Math.max(safeApprovals.length, 10)} color="#d2a8ff" />
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Section
          icon={AlertTriangle}
          title="Excepciones que requieren atencion"
          action={<button onClick={() => navigate('/inventario')} className="text-xs text-primary hover:underline">Ver modulo</button>}
        >
          {exceptions.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 size={24} className="mx-auto text-emerald-400/70 mb-2" />
              <p className="text-sm text-foreground">Sin excepciones criticas</p>
              <p className="text-xs text-muted">Stock, aprobaciones y mermas bajo control</p>
            </div>
          ) : (
            <div>
              {exceptions.map((item, i) => <ExceptionRow key={`${item.title}-${i}`} {...item} />)}
            </div>
          )}
        </Section>

        <Section
          icon={BarChart3}
          title={`Actividad reciente (${periodLabel})`}
          action={<button onClick={() => navigate('/kardex')} className="text-xs text-primary hover:underline">Kardex</button>}
        >
          {loadingKardex && !recentEvents.length ? (
            <SpinnerBlock rows={6} />
          ) : recentEvents.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">Sin eventos recientes</div>
          ) : (
            <div>{recentEvents.map((event, i) => <RecentRow key={`${event.title}-${i}`} {...event} />)}</div>
          )}
        </Section>

        <Section
          icon={Clock3}
          title="Aprobaciones por tipo"
          action={<button onClick={() => navigate('/aprobaciones')} className="text-xs text-primary hover:underline">Gestionar</button>}
        >
          {loadingPending && !safeApprovals.length ? (
            <SpinnerBlock rows={4} />
          ) : safeApprovals.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 size={24} className="mx-auto text-emerald-400/70 mb-2" />
              <p className="text-sm text-foreground">Nada pendiente</p>
              <p className="text-xs text-muted">No hay solicitudes bloqueando la operacion</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(approvalByType).map(([type, count]) => (
                <div key={type}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-xs text-foreground truncate">{APPROVAL_LABEL[type] || type.replace(/_/g, ' ')}</p>
                    <p className="text-xs font-semibold text-muted">{count}</p>
                  </div>
                  <MiniBar value={count} max={safeApprovals.length} color="#d2a8ff" />
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { icon: PackageCheck, label: 'Recepciones', to: '/recepciones', color: '#58a6ff' },
          { icon: Truck, label: 'Despachos', to: '/despachos', color: '#f0883e' },
          { icon: Warehouse, label: 'Inventario', to: '/inventario', color: '#3fb950' },
          { icon: ClipboardList, label: 'Aprobaciones', to: '/aprobaciones', color: '#d2a8ff', badge: safeApprovals.length },
        ].map(({ icon: Icon, label, to, color, badge }) => (
          <button
            key={to}
            type="button"
            onClick={() => navigate(to)}
            className="flex items-center gap-2.5 p-3 bg-surface border border-border rounded-xl text-muted hover:text-foreground transition-colors"
          >
            <span className="p-1.5 rounded-lg shrink-0" style={{ background: `${color}18` }}>
              <Icon size={14} style={{ color }} />
            </span>
            <span className="text-xs font-medium flex-1 text-left">{label}</span>
            {badge ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: `${color}20`, color }}>{badge}</span>
            ) : (
              <ArrowRight size={12} className="text-muted" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
