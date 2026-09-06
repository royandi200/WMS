import { useCallback, useEffect, useRef, useState } from 'react'
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
import client from '../api/client'
import { formatBogotaDateTime } from '../utils/dateTime'

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

function fmtN(value, decimals = 0) {
  if (value == null || Number.isNaN(Number(value))) return '-'
  return Number(value).toLocaleString('es-CO', { maximumFractionDigits: decimals })
}

function toDate(value) {
  const d = value ? new Date(value) : null
  return d && !Number.isNaN(d.getTime()) ? d : null
}

function hoursSince(value) {
  const d = toDate(value)
  if (!d) return null
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 36e5))
}

function totalsText(rows) {
  return rows?.length ? rows.map(row => `${fmtN(row.quantity, 4)} ${row.unit}`).join(' | ') : '0'
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
      className="group text-left bg-surface border border-border rounded-lg p-4 min-w-[220px] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
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
          <div className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
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

          <div className="mt-4 grid grid-cols-1 gap-2">
            {metrics.map((m) => (
              <div key={m.label} className="rounded-lg border border-border/70 bg-background/30 px-3 py-2">
                <p className="text-[10px] text-muted break-words">{m.label}</p>
                <p className="text-sm font-semibold tabular-nums break-words" style={{ color: m.color || '#e6edf3' }}>
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
    <section className="bg-surface border border-border rounded-lg overflow-hidden">
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
  const [period, setPeriod] = useState('week')
  const [refreshing, setRefreshing] = useState(false)
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const requestId = useRef(0)

  const loadAll = useCallback(async () => {
    const id = ++requestId.current
    setRefreshing(true)
    try {
      const [metrics, inventory, lowStock] = await Promise.all([
        client.get('/dashboard', { params: { period }, timeout: 30000 }),
        client.get('/inventory/summary'),
        client.get('/inventory/low-stock'),
      ])
      if (id !== requestId.current) return
      if (![metrics, inventory, lowStock].every(response => response.data?.ok === true)) {
        throw new Error('Respuesta incompleta de indicadores')
      }
      setSnapshot({ period, metrics: metrics.data.data, summary: inventory.data.data,
        lowStock: lowStock.data.data, updatedAt: Date.now() })
      setError('')
    } catch (e) {
      if (id === requestId.current) setError(e.response?.data?.error || 'No se pudieron actualizar los indicadores')
    } finally {
      if (id === requestId.current) setRefreshing(false)
    }
  }, [period])

  useEffect(() => {
    loadAll()
    const id = window.setInterval(loadAll, 30000)
    return () => { window.clearInterval(id); requestId.current += 1 }
  }, [loadAll])

  const refresh = loadAll
  const current = snapshot?.period === period ? snapshot : null
  const metrics = current?.metrics
  const summary = current?.summary
  const safeLowStock = current?.lowStock || []
  const periodLabel = PERIODS.find(p => p.key === period)?.label || 'Periodo'
  const lastUpdate = current?.updatedAt
  const isLoadingCore = !metrics
  const receptionLoading = isLoadingCore
  const productionLoading = isLoadingCore
  const wasteLoading = isLoadingCore
  const loadingPending = isLoadingCore
  const loadingKardex = isLoadingCore
  const scopedReceptionCount = metrics?.reception.count || 0
  const productionByStatus = metrics?.production.byStatus || {}
  const activeProductions = ['PLANEADA', 'APROBADA', 'EN_PROCESO']
    .reduce((n, state) => n + (productionByStatus[state] || 0), 0)
  const closedInPeriod = metrics?.production.closed || 0
  const approvalByType = metrics?.approvals?.byType || {}
  const approvalCount = metrics?.approvals?.count || 0
  const oldestApprovalHours = hoursSince(metrics?.approvals?.oldest) || 0
  const stockAlerts = Number(summary?.bajo_stock || 0)
  const expiringLots = Number(summary?.vencimientos_proximos || 0)
  const dwellAlerts = Number(summary?.permanencia_alertas || 0)
  const dwellDays = Number(summary?.permanencia_dias || 90)
  const wasteCount = metrics?.waste.count || 0
  const rejected = metrics?.reception.rejected || []
  const hasRejected = rejected.some(row => row.quantity > 0)

  const exceptions = [
    ...safeLowStock.slice(0, 3).map((item) => ({
      severity: Number(item.disponible ?? item.stock ?? 0) <= Number(item.min_stock ?? 0) * 0.35 ? 'alta' : 'media',
      title: `${item.sku || item.iditem || 'SKU'} bajo minimo`,
      detail: `${item.name || item.nombre || 'Producto'}: ${fmtN(item.disponible ?? item.stock)} / min ${fmtN(item.min_stock)}`,
      to: '/inventario',
    })),
    ...(approvalCount ? [{
      severity: oldestApprovalHours >= 6 ? 'alta' : 'media',
      title: `${approvalCount} aprobaciones pendientes`,
      detail: oldestApprovalHours ? `Mas antigua: ${oldestApprovalHours} h` : 'Requieren decision del supervisor',
      to: '/aprobaciones',
    }] : []),
    ...(expiringLots ? [{
      severity: 'media',
      title: `${expiringLots} lotes proximos a vencer`,
      detail: 'Revisar FEFO, cuarentena o disposicion',
      to: '/inventario',
    }] : []),
    ...(dwellAlerts ? [{
      severity: 'media',
      title: `${dwellAlerts} lotes con permanencia prolongada`,
      detail: `Segun el umbral de cada SKU (predeterminado: ${dwellDays} dias)`,
      to: '/inventario',
    }] : []),
    ...(wasteCount ? [{
      severity: 'media',
      title: `${wasteCount} registros de merma`,
      detail: `${totalsText(metrics?.waste.quantities)} en ${periodLabel.toLowerCase()}`,
      to: '/mermas',
    }] : []),
  ].slice(0, 6)

  const recentEvents = (metrics?.recent || []).map(row => ({
    title: row.action.replace(/_/g, ' '),
    detail: `${row.sku} | ${row.reference || '-'} | ${formatBogotaDateTime(row.created_at)}`,
    amount: `${Number(row.qty) > 0 ? '+' : ''}${fmtN(row.qty, 4)} ${row.unit || 'sin unidad'}`,
    color: Number(row.qty) > 0 ? '#3fb950' : Number(row.qty) < 0 ? '#f0883e' : '#8b949e',
  }))

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
            <span>{lastUpdate ? `actualizado ${Math.max(0, Math.floor((Date.now() - lastUpdate) / 1000))}s` : 'Sin datos actualizados'}</span>
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

      {error && <div role="alert" className="border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-300">
        {error}. {current ? 'Se muestran los ultimos datos obtenidos.' : 'No hay datos disponibles para este periodo.'}
      </div>}
      <section className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck size={15} className="text-primary shrink-0" />
            <h2 className="text-sm font-semibold text-foreground truncate">Plano de operaciones</h2>
            <span className="text-[9px] text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0.5 rounded-full font-semibold">{error || !metrics ? 'SIN ACTUALIZAR' : 'LIVE'}</span>
          </div>
          <div className="hidden sm:flex items-center gap-1 text-[11px] text-muted">
            <Radio size={12} className="text-emerald-400" />
            {error || !metrics ? 'Pendiente de actualizar' : 'Actualizacion automatica'}
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
              primary={fmtN(scopedReceptionCount)}
              primaryLabel={`rec. ${periodLabel.toLowerCase()}`}
              loading={receptionLoading}
              alert={hasRejected}
              metrics={[
                { label: 'Recibido', value: totalsText(metrics?.reception.quantities) },
                { label: 'Rechazado', value: totalsText(rejected), color: hasRejected ? '#f85149' : '#8b949e' },
              ]}
              footer={`Recepciones confirmadas: ${periodLabel.toLowerCase()}`}
            />
            <StageCard
              icon={Warehouse}
              title="Almacen"
              subtitle="Stock, reserva y riesgo"
              color="#3fb950"
              href="/inventario"
              primary={fmtN(metrics?.stock.products)}
              primaryLabel="SKU con disponible"
              loading={isLoadingCore}
              alert={stockAlerts > 0 || expiringLots > 0 || dwellAlerts > 0}
              metrics={[
                { label: 'Disponible', value: totalsText(metrics?.stock.quantities) },
                { label: 'Reservado disponible', value: totalsText(metrics?.stock.reserved) },
              ]}
              footer={dwellAlerts
                ? `${dwellAlerts} lotes con ${dwellDays}+ dias en bodega`
                : expiringLots ? `${expiringLots} lotes proximos a vencer` : 'Sin alertas de permanencia'}
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
              primary={fmtN(wasteCount)}
              primaryLabel={`registros ${periodLabel.toLowerCase()}`}
              loading={wasteLoading}
              alert={wasteCount > 0}
              metrics={[
                { label: 'Cantidad', value: totalsText(metrics?.waste.quantities) },
                { label: 'Ordenes afectadas', value: fmtN(metrics?.waste.orders) },
              ]}
              footer={wasteCount ? 'Bodega y produccion' : 'Sin mermas en periodo'}
            />
            <StageCard
              icon={ClipboardList}
              title="Aprobaciones"
              subtitle="Bloqueos operativos"
              color="#d2a8ff"
              href="/aprobaciones"
              primary={metrics?.approvals ? fmtN(approvalCount) : '-'}
              primaryLabel="pendientes"
              loading={loadingPending}
              alert={approvalCount > 0}
              metrics={[
                { label: 'Mas antigua', value: oldestApprovalHours ? `${oldestApprovalHours} h` : '-' },
                { label: 'Produccion', value: fmtN((approvalByType.SOLICITAR_INICIO_PRODUCCION || 0) + (approvalByType.SOLICITAR_CIERRE_PRODUCCION || 0)) },
              ]}
              footer={metrics?.approvals ? 'Solicitudes pendientes actuales' : 'Sin permiso para consultar aprobaciones'}
            />
          </div>

          <div className="mt-5 pt-4 border-t border-border/50 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-[10px] text-muted uppercase">Entradas</p>
              <p className="text-sm font-semibold text-foreground break-words">{metrics ? totalsText(metrics.flows.entry.quantities) : '-'}</p>
              <p className="text-xs text-muted">{metrics?.flows.entry.count ?? '-'} movimientos de ingreso</p>
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase">Salidas</p>
              <p className="text-sm font-semibold text-foreground break-words">{metrics ? totalsText(metrics.flows.exit.quantities) : '-'}</p>
              <p className="text-xs text-muted">{metrics?.flows.exit.count ?? '-'} movimientos de salida</p>
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase">Mermas</p>
              <p className="text-sm font-semibold text-foreground break-words">{metrics ? totalsText(metrics.waste.quantities) : '-'}</p>
              <p className="text-xs text-muted">{metrics?.waste.count ?? '-'} registros</p>
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase">Pendientes</p>
              <p className="text-sm font-semibold text-foreground">{fmtN(approvalCount)} aprobaciones</p>
              <MiniBar value={approvalCount} max={Math.max(approvalCount, 10)} color="#d2a8ff" />
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
          {!metrics ? <SpinnerBlock /> : exceptions.length === 0 ? (
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
          {loadingPending && !approvalCount ? (
            <SpinnerBlock rows={4} />
          ) : !metrics?.approvals ? <p className="text-sm text-muted">Sin permiso para consultar aprobaciones</p> : approvalCount === 0 ? (
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
                  <MiniBar value={count} max={approvalCount} color="#d2a8ff" />
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
          { icon: ClipboardList, label: 'Aprobaciones', to: '/aprobaciones', color: '#d2a8ff', badge: approvalCount },
        ].map(({ icon: Icon, label, to, color, badge }) => (
          <button
            key={to}
            type="button"
            onClick={() => navigate(to)}
            className="flex items-center gap-2.5 p-3 bg-surface border border-border rounded-lg text-muted hover:text-foreground transition-colors"
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
