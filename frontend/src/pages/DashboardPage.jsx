import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInventoryStore } from '../store/inventoryStore'
import { useApprovalsStore } from '../store/approvalsStore'
import { useAuthStore } from '../store/authStore'
import {
  Package, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle, Clock, ArrowRight, RefreshCw,
  BarChart3, Truck, Warehouse, ClipboardList,
  Activity, ChevronRight, Zap
} from 'lucide-react'

// ─── Animación de número contando ────────────────────────────────────────────
function AnimatedNumber({ value, duration = 1200, prefix = '', suffix = '' }) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef(null)
  const prevRef = useRef(0)

  useEffect(() => {
    if (value === null || value === undefined) return
    const start = prevRef.current
    const end = Number(value) || 0
    const startTime = performance.now()

    const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

    const tick = (now) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const current = Math.round(start + (end - start) * ease(progress))
      setDisplay(current)
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
      else prevRef.current = end
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])

  return <span>{prefix}{display.toLocaleString('es-CO')}{suffix}</span>
}

// ─── Sparkline SVG mini gráfico ───────────────────────────────────────────────
function Sparkline({ data = [], color = '#f0883e', height = 36 }) {
  if (!data.length) return null
  const w = 120, h = height
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-70">
      <defs>
        <linearGradient id={`sg-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round"
        points={pts}
      />
      <polygon
        fill={`url(#sg-${color.replace('#','')})`}
        points={`0,${h} ${pts} ${w},${h}`}
      />
    </svg>
  )
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────
function Skeleton({ className = '' }) {
  return (
    <div className={`animate-pulse bg-surface rounded-md ${className}`} />
  )
}

// ─── KPI Card con animación stagger ──────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color, trend, sparkData, delay = 0, loading }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  if (loading) return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <Skeleton className="h-4 w-24 mb-3" />
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-3 w-32" />
    </div>
  )

  return (
    <div
      className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-3 transition-all duration-500"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(16px)',
        transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms, box-shadow 0.2s`,
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = `0 0 0 1px ${color}40, 0 8px 24px ${color}15`}
      onMouseLeave={e => e.currentTarget.style.boxShadow = ''}
    >
      <div className="flex items-center justify-between">
        <span className="text-muted text-xs font-medium uppercase tracking-wider">{label}</span>
        <div className="p-1.5 rounded-lg" style={{ background: `${color}18` }}>
          <Icon size={14} style={{ color }} />
        </div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-foreground text-2xl font-bold tabular-nums">
            <AnimatedNumber value={value} />
          </div>
          {sub && (
            <div className={`flex items-center gap-1 mt-1 text-xs ${
              trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-muted'
            }`}>
              {trend === 'up' && <TrendingUp size={11} />}
              {trend === 'down' && <TrendingDown size={11} />}
              {sub}
            </div>
          )}
        </div>
        {sparkData && <Sparkline data={sparkData} color={color} />}
      </div>
    </div>
  )
}

// ─── Mini Barra de actividad reciente ─────────────────────────────────────────
const TIPO_META = {
  ENTRADA:   { label: 'Entrada',   color: '#3fb950', bg: '#3fb95018' },
  SALIDA:    { label: 'Salida',    color: '#f0883e', bg: '#f0883e18' },
  MERMA:     { label: 'Merma',     color: '#f85149', bg: '#f8514918' },
  TRASLADO:  { label: 'Traslado', color: '#79c0ff', bg: '#79c0ff18' },
  AJUSTE:    { label: 'Ajuste',   color: '#d2a8ff', bg: '#d2a8ff18' },
}

function KardexRow({ row, index }) {
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVis(true), 60 * index)
    return () => clearTimeout(t)
  }, [index])
  const meta = TIPO_META[row.tipo?.toUpperCase()] || { label: row.tipo, color: '#8b949e', bg: '#8b949e18' }
  const fecha = row.creadoen ? new Date(row.creadoen).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '--'
  return (
    <div
      className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0"
      style={{
        opacity: vis ? 1 : 0,
        transform: vis ? 'translateX(0)' : 'translateX(-10px)',
        transition: `opacity 0.35s ease ${60 * index}ms, transform 0.35s ease ${60 * index}ms`,
      }}
    >
      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: meta.color }} />
      <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ color: meta.color, background: meta.bg }}>
        {meta.label}
      </span>
      <span className="text-subtle text-xs flex-1 truncate">{row.siigocode || row.productoid || '—'}</span>
      <span className="text-muted text-xs tabular-nums">
        {row.cantidad > 0 ? '+' : ''}{Number(row.cantidad || 0).toLocaleString('es-CO')}
      </span>
      <span className="text-muted text-xs w-14 text-right">{fecha}</span>
    </div>
  )
}

// ─── Alert de stock bajo ──────────────────────────────────────────────────────
function StockAlert({ item, index }) {
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVis(true), 80 * index)
    return () => clearTimeout(t)
  }, [index])
  const pct = item.stockminimo > 0 ? Math.min((item.totalstock / item.stockminimo) * 100, 100) : 0
  const critical = pct < 30
  return (
    <div
      className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0"
      style={{
        opacity: vis ? 1 : 0,
        transform: vis ? 'translateY(0)' : 'translateY(8px)',
        transition: `opacity 0.4s ease ${80 * index}ms, transform 0.4s ease ${80 * index}ms`,
      }}
    >
      <AlertTriangle size={13} className={critical ? 'text-red-400' : 'text-amber-400'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-subtle text-xs truncate font-medium">{item.nombre || item.siigocode}</span>
          <span className="text-muted text-xs tabular-nums">
            {Number(item.totalstock || 0).toLocaleString('es-CO')} / {Number(item.stockminimo || 0).toLocaleString('es-CO')}
          </span>
        </div>
        <div className="h-1 bg-border rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${pct}%`,
              background: critical ? '#f85149' : '#f0883e',
              boxShadow: `0 0 6px ${critical ? '#f85149' : '#f0883e'}60`,
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Aprobación pendiente ─────────────────────────────────────────────────────
const ACCION_META = {
  DESPACHO:   { color: '#f0883e' },
  RECEPCION:  { color: '#3fb950' },
  MERMA:      { color: '#f85149' },
  PRODUCCION: { color: '#79c0ff' },
}
function ApprovalRow({ item, index, onNavigate }) {
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVis(true), 70 * index)
    return () => clearTimeout(t)
  }, [index])
  const meta = ACCION_META[item.accion?.toUpperCase()] || { color: '#8b949e' }
  return (
    <div
      className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0 cursor-pointer group"
      style={{
        opacity: vis ? 1 : 0,
        transform: vis ? 'translateX(0)' : 'translateX(10px)',
        transition: `opacity 0.4s ease ${70 * index}ms, transform 0.4s ease ${70 * index}ms`,
      }}
      onClick={onNavigate}
    >
      <div className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: meta.color }} />
      <div className="flex-1 min-w-0">
        <div className="text-subtle text-xs font-medium truncate">{item.codigosolicitud || item.id}</div>
        <div className="text-muted text-xs">{item.accion}</div>
      </div>
      <ChevronRight size={12} className="text-muted group-hover:text-primary transition-colors" />
    </div>
  )
}

// ─── Gráfico de barras tipo kardex por tipo ────────────────────────────────────
function ActivityChart({ data = [], loading }) {
  const tipos = ['ENTRADA', 'SALIDA', 'MERMA']
  const colores = { ENTRADA: '#3fb950', SALIDA: '#f0883e', MERMA: '#f85149' }
  const [animated, setAnimated] = useState(false)

  useEffect(() => {
    if (!loading && data.length) {
      const t = setTimeout(() => setAnimated(true), 200)
      return () => clearTimeout(t)
    }
  }, [loading, data])

  // Agrupar por fecha los últimos 7 días
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().split('T')[0])
  }

  const grouped = days.map(day => {
    const rows = data.filter(r => (r.creadoen || '').startsWith(day))
    return {
      day: day.slice(5), // MM-DD
      ENTRADA: rows.filter(r => r.tipo?.toUpperCase() === 'ENTRADA').reduce((s, r) => s + Number(r.cantidad || 0), 0),
      SALIDA:  rows.filter(r => r.tipo?.toUpperCase() === 'SALIDA').reduce((s, r) => s + Number(r.cantidad || 0), 0),
      MERMA:   rows.filter(r => r.tipo?.toUpperCase() === 'MERMA').reduce((s, r) => s + Number(r.cantidad || 0), 0),
    }
  })

  const maxVal = Math.max(...grouped.flatMap(g => tipos.map(t => g[t])), 1)

  if (loading) return (
    <div className="flex items-end gap-2 h-24">
      {[40, 70, 55, 80, 45, 65, 90].map((h, i) => (
        <Skeleton key={i} className={`flex-1`} style={{ height: `${h}%` }} />
      ))}
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1.5 h-24">
        {grouped.map((g, gi) => (
          <div key={g.day} className="flex-1 flex flex-col items-center gap-0.5">
            <div className="w-full flex flex-col gap-0.5">
              {tipos.map((tipo) => (
                <div
                  key={tipo}
                  title={`${tipo}: ${g[tipo]}`}
                  className="w-full rounded-sm transition-all duration-700"
                  style={{
                    height: animated ? `${Math.max((g[tipo] / maxVal) * 60, g[tipo] > 0 ? 2 : 0)}px` : '0px',
                    background: colores[tipo],
                    opacity: g[tipo] > 0 ? 0.85 : 0,
                    transitionDelay: `${gi * 60}ms`,
                    boxShadow: g[tipo] > 0 ? `0 0 4px ${colores[tipo]}60` : 'none',
                  }}
                />
              ))}
            </div>
            <span className="text-muted text-xs mt-1">{g.day}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        {tipos.map(t => (
          <div key={t} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm" style={{ background: colores[t] }} />
            <span className="text-muted text-xs">{t.charAt(0) + t.slice(1).toLowerCase()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── FILTRO DE PERÍODO ────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'today',  label: 'Hoy' },
  { key: 'week',   label: '7 días' },
  { key: 'month',  label: '30 días' },
]

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate   = useNavigate()
  const { user }   = useAuthStore()
  const {
    summary, lowStock, kardex, kardexMeta,
    loading: invLoading,
    fetchSummary, fetchLowStock, fetchKardex,
  } = useInventoryStore()
  const {
    list: approvals, loading: appLoading,
    fetchList: fetchApprovals,
  } = useApprovalsStore()

  const [period, setPeriod]     = useState('week')
  const [refreshing, setRefreshing] = useState(false)
  const [headerVis, setHeaderVis]   = useState(false)

  const kardexParams = useCallback(() => {
    const d = new Date()
    const until = d.toISOString().split('T')[0]
    if (period === 'today') {
      return { since: until, until, limit: 100 }
    } else if (period === 'week') {
      d.setDate(d.getDate() - 7)
      return { since: d.toISOString().split('T')[0], until, limit: 100 }
    } else {
      d.setDate(d.getDate() - 30)
      return { since: d.toISOString().split('T')[0], until, limit: 100 }
    }
  }, [period])

  const loadAll = useCallback(async () => {
    await Promise.all([
      fetchSummary(),
      fetchLowStock(),
      fetchKardex(kardexParams()),
      fetchApprovals({ estado: 'PENDIENTE', limit: 10 }),
    ])
  }, [fetchSummary, fetchLowStock, fetchKardex, fetchApprovals, kardexParams])

  useEffect(() => {
    loadAll()
    setTimeout(() => setHeaderVis(true), 50)
  }, []) // eslint-disable-line

  useEffect(() => {
    fetchKardex(kardexParams())
  }, [period]) // eslint-disable-line

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadAll()
    setRefreshing(false)
  }

  const loading = invLoading || appLoading

  // Derivar sparklines de kardex (últimos 7 días por tipo)
  const sparkEntrada = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const day = d.toISOString().split('T')[0]
    return (kardex || []).filter(r => r.tipo?.toUpperCase() === 'ENTRADA' && (r.creadoen || '').startsWith(day))
      .reduce((s, r) => s + Number(r.cantidad || 0), 0)
  })
  const sparkSalida = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const day = d.toISOString().split('T')[0]
    return (kardex || []).filter(r => r.tipo?.toUpperCase() === 'SALIDA' && (r.creadoen || '').startsWith(day))
      .reduce((s, r) => s + Number(r.cantidad || 0), 0)
  })

  const totalEntradas = (kardex || []).filter(r => r.tipo?.toUpperCase() === 'ENTRADA').reduce((s, r) => s + Number(r.cantidad || 0), 0)
  const totalSalidas  = (kardex || []).filter(r => r.tipo?.toUpperCase() === 'SALIDA').reduce((s, r) => s + Number(r.cantidad || 0), 0)

  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div className="flex-1 overflow-y-auto">
      {/* ── Header greeting ── */}
      <div
        className="px-6 pt-6 pb-4 flex items-center justify-between"
        style={{
          opacity: headerVis ? 1 : 0,
          transform: headerVis ? 'translateY(0)' : 'translateY(-12px)',
          transition: 'opacity 0.4s ease, transform 0.4s ease',
        }}
      >
        <div>
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-primary" />
            <h1 className="text-foreground font-semibold text-base">
              {saludo}, {user?.nombre?.split(' ')[0] || 'usuario'}
            </h1>
          </div>
          <p className="text-muted text-xs mt-0.5">
            {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Filtro de período */}
          <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className="text-xs px-3 py-1 rounded-md transition-all duration-200"
                style={{
                  background: period === p.key ? '#f0883e18' : 'transparent',
                  color: period === p.key ? '#f0883e' : '#8b949e',
                  fontWeight: period === p.key ? 600 : 400,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-foreground transition-all"
            title="Actualizar"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="px-6 pb-8 space-y-6">

        {/* ── KPI Grid ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon={Package}
            label="Productos activos"
            value={summary?.totalProducts ?? summary?.total_products ?? null}
            sub="en catálogo"
            color="#f0883e"
            delay={0}
            loading={invLoading && !summary}
          />
          <KpiCard
            icon={Warehouse}
            label="Unidades en stock"
            value={summary?.totalStock ?? summary?.total_stock ?? null}
            sub="inventario total"
            color="#3fb950"
            sparkData={sparkEntrada}
            delay={80}
            loading={invLoading && !summary}
          />
          <KpiCard
            icon={TrendingUp}
            label="Entradas"
            value={totalEntradas}
            sub={`en ${PERIODS.find(p => p.key === period)?.label}`}
            trend="up"
            color="#79c0ff"
            sparkData={sparkEntrada}
            delay={160}
            loading={invLoading && !kardex.length}
          />
          <KpiCard
            icon={TrendingDown}
            label="Salidas"
            value={totalSalidas}
            sub={`en ${PERIODS.find(p => p.key === period)?.label}`}
            trend="down"
            color="#d2a8ff"
            sparkData={sparkSalida}
            delay={240}
            loading={invLoading && !kardex.length}
          />
        </div>

        {/* ── Fila principal: Gráfico + Aprobaciones ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Gráfico actividad kardex */}
          <div
            className="lg:col-span-2 bg-surface border border-border rounded-xl p-5"
            style={{ animation: 'fadeSlideUp 0.5s ease 0.3s both' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-primary" />
                <span className="text-subtle text-sm font-semibold">Actividad del inventario</span>
              </div>
              <span className="text-muted text-xs">
                {PERIODS.find(p => p.key === period)?.label}
              </span>
            </div>
            <ActivityChart data={kardex} loading={invLoading && !kardex.length} />
          </div>

          {/* Aprobaciones pendientes */}
          <div
            className="bg-surface border border-border rounded-xl p-5 flex flex-col"
            style={{ animation: 'fadeSlideUp 0.5s ease 0.4s both' }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-amber-400" />
                <span className="text-subtle text-sm font-semibold">Aprobaciones</span>
              </div>
              {approvals.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-400 font-semibold">
                  {approvals.length}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto max-h-44">
              {appLoading && !approvals.length ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : approvals.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-24 gap-2">
                  <CheckCircle size={20} className="text-emerald-400/60" />
                  <span className="text-muted text-xs">Sin pendientes</span>
                </div>
              ) : (
                approvals.slice(0, 8).map((item, i) => (
                  <ApprovalRow
                    key={item.id}
                    item={item}
                    index={i}
                    onNavigate={() => navigate('/aprobaciones')}
                  />
                ))
              )}
            </div>
            {approvals.length > 0 && (
              <button
                onClick={() => navigate('/aprobaciones')}
                className="mt-3 flex items-center justify-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors py-1.5 border-t border-border/40"
              >
                Ver todas <ArrowRight size={11} />
              </button>
            )}
          </div>
        </div>

        {/* ── Fila secundaria: Actividad reciente + Stock bajo ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Actividad reciente del kardex */}
          <div
            className="bg-surface border border-border rounded-xl p-5"
            style={{ animation: 'fadeSlideUp 0.5s ease 0.5s both' }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BarChart3 size={14} className="text-primary" />
                <span className="text-subtle text-sm font-semibold">Movimientos recientes</span>
              </div>
              <button
                onClick={() => navigate('/kardex')}
                className="text-xs text-muted hover:text-primary transition-colors flex items-center gap-1"
              >
                Ver más <ChevronRight size={11} />
              </button>
            </div>
            <div className="space-y-0">
              {invLoading && !kardex.length ? (
                <div className="space-y-2">
                  {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-7 w-full" />)}
                </div>
              ) : kardex.length === 0 ? (
                <div className="text-center text-muted text-xs py-6">Sin movimientos en el período</div>
              ) : (
                kardex.slice(0, 8).map((row, i) => (
                  <KardexRow key={row.id || i} row={row} index={i} />
                ))
              )}
            </div>
          </div>

          {/* Alertas stock bajo */}
          <div
            className="bg-surface border border-border rounded-xl p-5"
            style={{ animation: 'fadeSlideUp 0.5s ease 0.6s both' }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-400" />
                <span className="text-subtle text-sm font-semibold">Stock bajo mínimo</span>
              </div>
              {lowStock.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-400/15 text-red-400 font-semibold">
                  {lowStock.length}
                </span>
              )}
            </div>
            <div>
              {invLoading && !lowStock.length ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : lowStock.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-24 gap-2">
                  <CheckCircle size={20} className="text-emerald-400/60" />
                  <span className="text-muted text-xs">Todo el stock en niveles normales</span>
                </div>
              ) : (
                lowStock.slice(0, 6).map((item, i) => (
                  <StockAlert key={item.id || i} item={item} index={i} />
                ))
              )}
            </div>
            {lowStock.length > 0 && (
              <button
                onClick={() => navigate('/inventario')}
                className="mt-3 flex items-center justify-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors py-1.5 border-t border-border/40"
              >
                Ver inventario <ArrowRight size={11} />
              </button>
            )}
          </div>
        </div>

        {/* ── Accesos rápidos ── */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-2"
          style={{ animation: 'fadeSlideUp 0.5s ease 0.7s both' }}
        >
          {[
            { icon: Warehouse,     label: 'Recepciones',  to: '/recepciones',  color: '#3fb950' },
            { icon: Truck,         label: 'Despachos',    to: '/despachos',    color: '#f0883e' },
            { icon: Package,       label: 'Inventario',   to: '/inventario',   color: '#79c0ff' },
            { icon: ClipboardList, label: 'Aprobaciones', to: '/aprobaciones', color: '#d2a8ff', badge: approvals.length || null },
          ].map(({ icon: Icon, label, to, color, badge }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="flex items-center gap-2.5 p-3.5 bg-surface border border-border rounded-xl text-muted hover:text-foreground group transition-all duration-200"
              style={{ '--hover-color': color }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = `${color}60`
                e.currentTarget.style.boxShadow = `0 0 12px ${color}10`
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = ''
                e.currentTarget.style.boxShadow = ''
              }}
            >
              <div className="p-1.5 rounded-lg flex-shrink-0" style={{ background: `${color}15` }}>
                <Icon size={13} style={{ color }} />
              </div>
              <span className="text-xs font-medium flex-1 text-left">{label}</span>
              {badge ? (
                <span className="text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${color}20`, color }}>
                  {badge}
                </span>
              ) : (
                <ArrowRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color }} />
              )}
            </button>
          ))}
        </div>

      </div>

      {/* Keyframes inline */}
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
