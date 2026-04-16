import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
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

function periodStart(period) {
  const d = new Date()
  if (period === 'today') { d.setHours(0, 0, 0, 0); return d }
  d.setDate(d.getDate() - (period === 'week' ? 7 : 30))
  d.setHours(0, 0, 0, 0)
  return d
}

function AnimatedNumber({ value, duration = 1000 }) {
  const [display, setDisplay] = useState(0)
  const rafRef  = useRef(null)
  const prevRef = useRef(0)
  useEffect(() => {
    if (value === null || value === undefined) return
    const start = prevRef.current
    const end   = Number(value) || 0
    const t0    = performance.now()
    const ease  = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2
    const tick  = now => {
      const p = Math.min((now - t0) / duration, 1)
      setDisplay(Math.round(start + (end - start) * ease(p)))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
      else prevRef.current = end
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])
  return <span>{display.toLocaleString('es-CO')}</span>
}

function Sparkline({ data = [], color = '#f0883e', height = 36 }) {
  if (!data.length || data.every(v => v === 0)) return null
  const w = 120, h = height
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 2) - 1
    return `${x},${y}`
  }).join(' ')
  const gid = `sg${color.replace('#','')}`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-70">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" points={pts}/>
      <polygon fill={`url(#${gid})`} points={`0,${h} ${pts} ${w},${h}`}/>
    </svg>
  )
}

function Sk({ className='', style={} }) {
  return <div className={`animate-pulse bg-surface-offset rounded-md ${className}`} style={style}/>
}

function KpiCard({ icon: Icon, label, value, sub, color, trend, sparkData, delay=0, loading }) {
  const [vis, setVis] = useState(false)
  useEffect(() => { const t = setTimeout(()=>setVis(true), delay); return ()=>clearTimeout(t) }, [delay])
  if (loading) return (
    <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
      <Sk className="h-3 w-20"/><Sk className="h-7 w-14"/><Sk className="h-3 w-28"/>
    </div>
  )
  return (
    <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-3"
      style={{opacity:vis?1:0,transform:vis?'translateY(0)':'translateY(14px)',
        transition:`opacity .5s ease ${delay}ms,transform .5s ease ${delay}ms,box-shadow .2s`}}
      onMouseEnter={e=>e.currentTarget.style.boxShadow=`0 0 0 1px ${color}40,0 8px 24px ${color}15`}
      onMouseLeave={e=>e.currentTarget.style.boxShadow=''}>
      <div className="flex items-center justify-between">
        <span className="text-muted text-xs font-medium uppercase tracking-wider">{label}</span>
        <div className="p-1.5 rounded-lg" style={{background:`${color}18`}}><Icon size={14} style={{color}}/></div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-foreground text-2xl font-bold tabular-nums">
            <AnimatedNumber value={value ?? 0}/>
          </div>
          {sub && (
            <div className={`flex items-center gap-1 mt-1 text-xs ${
              trend==='up'?'text-emerald-400':trend==='down'?'text-red-400':'text-muted'}`}>
              {trend==='up'   && <TrendingUp   size={11}/>}
              {trend==='down' && <TrendingDown size={11}/>}
              {sub}
            </div>
          )}
        </div>
        {sparkData && <Sparkline data={sparkData} color={color}/>}
      </div>
    </div>
  )
}

const TIPO_META = {
  entrada:  { label:'Entrada',  color:'#3fb950', bg:'#3fb95018' },
  salida:   { label:'Salida',   color:'#f0883e', bg:'#f0883e18' },
  merma:    { label:'Merma',    color:'#f85149', bg:'#f8514918' },
  traslado: { label:'Traslado', color:'#79c0ff', bg:'#79c0ff18' },
  ajuste:   { label:'Ajuste',   color:'#d2a8ff', bg:'#d2a8ff18' },
}

function KardexRow({ row, index }) {
  const [vis, setVis] = useState(false)
  useEffect(()=>{ const t=setTimeout(()=>setVis(true),55*index); return()=>clearTimeout(t) },[index])
  const tipo  = (row.tipo || '').toLowerCase()
  const meta  = TIPO_META[tipo] || { label: row.tipo, color:'#8b949e', bg:'#8b949e18' }
  const fecha = row.creado_en
    ? new Date(row.creado_en).toLocaleDateString('es-CO',{day:'2-digit',month:'short'})
    : '--'
  const label = row.producto?.siigo_code || row.producto?.nombre || row.producto_id || '—'
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0"
      style={{opacity:vis?1:0,transform:vis?'translateX(0)':'translateX(-8px)',
        transition:`opacity .3s ease ${55*index}ms,transform .3s ease ${55*index}ms`}}>
      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:meta.color}}/>
      <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{color:meta.color,background:meta.bg}}>
        {meta.label}
      </span>
      <span className="text-subtle text-xs flex-1 truncate">{label}</span>
      <span className="text-muted text-xs tabular-nums">
        {Number(row.cantidad)>0?'+':''}{Number(row.cantidad||0).toLocaleString('es-CO')}
      </span>
      <span className="text-muted text-xs w-14 text-right">{fecha}</span>
    </div>
  )
}

function StockAlert({ item, index }) {
  const [vis, setVis] = useState(false)
  useEffect(()=>{ const t=setTimeout(()=>setVis(true),75*index); return()=>clearTimeout(t) },[index])
  const nombre   = item.producto?.nombre || item.producto?.siigo_code || '—'
  const stockMin = parseFloat(item.stock_minimo    || 0)
  const stockAct = parseFloat(item.disponible_neto || 0)
  const pct      = stockMin > 0 ? Math.min((stockAct/stockMin)*100, 100) : 0
  const critical = pct < 30
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0"
      style={{opacity:vis?1:0,transform:vis?'translateY(0)':'translateY(6px)',
        transition:`opacity .4s ease ${75*index}ms,transform .4s ease ${75*index}ms`}}>
      <AlertTriangle size={13} className={critical?'text-red-400':'text-amber-400'}/>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-subtle text-xs truncate font-medium">{nombre}</span>
          <span className="text-muted text-xs tabular-nums">
            {stockAct.toLocaleString('es-CO')} / {stockMin.toLocaleString('es-CO')}
          </span>
        </div>
        <div className="h-1 bg-border rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-1000"
            style={{width:`${pct}%`,background:critical?'#f85149':'#f0883e',
              boxShadow:`0 0 6px ${critical?'#f85149':'#f0883e'}60`}}/>
        </div>
      </div>
    </div>
  )
}

const ACCION_META = {
  DESPACHO:{color:'#f0883e'}, RECEPCION:{color:'#3fb950'},
  MERMA:{color:'#f85149'},    PRODUCCION:{color:'#79c0ff'},
}
function ApprovalRow({ item, index, onNavigate }) {
  const [vis, setVis] = useState(false)
  useEffect(()=>{ const t=setTimeout(()=>setVis(true),65*index); return()=>clearTimeout(t) },[index])
  const meta = ACCION_META[item.accion?.toUpperCase()] || {color:'#8b949e'}
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0 cursor-pointer group"
      style={{opacity:vis?1:0,transform:vis?'translateX(0)':'translateX(8px)',
        transition:`opacity .4s ease ${65*index}ms,transform .4s ease ${65*index}ms`}}
      onClick={onNavigate}>
      <div className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{background:meta.color}}/>
      <div className="flex-1 min-w-0">
        <div className="text-subtle text-xs font-medium truncate">
          {item.codigosolicitud || item.codigo_solicitud || item.id}
        </div>
        <div className="text-muted text-xs">{item.accion}</div>
      </div>
      <ChevronRight size={12} className="text-muted group-hover:text-primary transition-colors"/>
    </div>
  )
}

function ActivityChart({ data=[], loading }) {
  const tipos   = ['entrada','salida','merma']
  const colores = { entrada:'#3fb950', salida:'#f0883e', merma:'#f85149' }
  const labels  = { entrada:'Entrada', salida:'Salida',  merma:'Merma'   }
  const [anim, setAnim] = useState(false)
  useEffect(()=>{
    setAnim(false)
    if (!loading && data.length) { const t=setTimeout(()=>setAnim(true),150); return()=>clearTimeout(t) }
  },[loading, data])
  const days = Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(6-i)); return d.toISOString().split('T')[0]
  })
  const grouped = days.map(day=>{
    const rows = data.filter(r=>(r.creado_en||'').startsWith(day))
    return {
      day: day.slice(5),
      entrada: rows.filter(r=>r.tipo==='entrada').reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0),
      salida:  rows.filter(r=>r.tipo==='salida') .reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0),
      merma:   rows.filter(r=>r.tipo==='merma')  .reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0),
    }
  })
  const maxVal = Math.max(...grouped.flatMap(g=>tipos.map(t=>g[t])),1)
  if (loading) return (
    <div className="flex items-end gap-2 h-24">
      {[40,70,55,80,45,65,90].map((h,i)=><Sk key={i} className="flex-1" style={{height:`${h}%`}}/>)}
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1.5 h-24">
        {grouped.map((g,gi)=>(
          <div key={g.day} className="flex-1 flex flex-col items-center">
            <div className="w-full flex flex-col-reverse gap-0.5 flex-1 justify-end">
              {tipos.map(tipo=>(
                <div key={tipo} title={`${labels[tipo]}: ${g[tipo]}`}
                  className="w-full rounded-sm transition-all duration-700"
                  style={{height:anim?`${Math.max((g[tipo]/maxVal)*88,g[tipo]>0?2:0)}px`:'0px',
                    background:colores[tipo],opacity:g[tipo]>0?.85:0,
                    transitionDelay:`${gi*55}ms`,
                    boxShadow:g[tipo]>0?`0 0 4px ${colores[tipo]}60`:'none'}}/>
              ))}
            </div>
            <span className="text-muted text-xs mt-1.5">{g.day}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-4">
        {tipos.map(t=>(
          <div key={t} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm" style={{background:colores[t]}}/>
            <span className="text-muted text-xs">{labels[t]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const PERIODS = [
  {key:'today',label:'Hoy'},
  {key:'week', label:'7 días'},
  {key:'month',label:'30 días'},
]

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const {
    summary, lowStock, kardex,
    loadingSummary, loadingKardex, loadingLowStock,
    fetchSummary, fetchLowStock, fetchKardex,
  } = useInventoryStore()
  const { list: approvals, loading: appLoading, fetchList: fetchApprovals } = useApprovalsStore()

  const [period,     setPeriod]    = useState('week')
  const [refreshing, setRefreshing]= useState(false)
  const [headerVis,  setHeaderVis] = useState(false)

  const loadAll = useCallback(async () => {
    await Promise.all([
      fetchSummary(),
      fetchLowStock(),
      fetchKardex({ limit: 200, page: 1 }),
      fetchApprovals({ estado: 'PENDIENTE', limit: 10 }),
    ])
  }, [fetchSummary, fetchLowStock, fetchKardex, fetchApprovals])

  useEffect(() => {
    loadAll()
    setTimeout(() => setHeaderVis(true), 50)
  }, []) // eslint-disable-line

  const handleRefresh = async () => { setRefreshing(true); await loadAll(); setRefreshing(false) }

  const filteredKardex = useMemo(() => {
    if (!Array.isArray(kardex) || !kardex.length) return []
    const since = periodStart(period)
    return kardex.filter(r => r.creado_en && new Date(r.creado_en) >= since)
  }, [kardex, period])

  const totalProducts = useMemo(() => {
    if (!summary) return null
    if (Array.isArray(summary)) return summary.length
    return summary.totalProducts ?? summary.total_products ?? 0
  }, [summary])

  const totalStock = useMemo(() => {
    if (!summary) return null
    if (Array.isArray(summary))
      return summary.reduce((acc, p) => acc + parseFloat(p.stock?.disponible_neto ?? p.stock?.fisico_total ?? 0), 0)
    return summary.totalStock ?? summary.total_stock ?? 0
  }, [summary])

  const totalEntradas = useMemo(() =>
    filteredKardex.filter(r=>r.tipo==='entrada').reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0)
  ,[filteredKardex])

  const totalSalidas = useMemo(() =>
    filteredKardex.filter(r=>r.tipo==='salida').reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0)
  ,[filteredKardex])

  const sparkEntrada = useMemo(() => Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(6-i)); const day=d.toISOString().split('T')[0]
    return (kardex||[]).filter(r=>r.tipo==='entrada'&&(r.creado_en||'').startsWith(day))
      .reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0)
  }),[kardex])

  const sparkSalida = useMemo(() => Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(6-i)); const day=d.toISOString().split('T')[0]
    return (kardex||[]).filter(r=>r.tipo==='salida'&&(r.creado_en||'').startsWith(day))
      .reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0)
  }),[kardex])

  // ── DEBUG: log cada vez que cambian los valores derivados ──────────────────
  useEffect(() => {
    console.group('[DASHBOARD] valores derivados')
    console.log('summary (tipo):', Array.isArray(summary) ? `Array[${summary?.length}]` : typeof summary, summary)
    console.log('totalProducts:', totalProducts)
    console.log('totalStock:', totalStock)
    console.log('kardex.length:', kardex?.length, '| filteredKardex.length:', filteredKardex.length)
    console.log('totalEntradas:', totalEntradas, '| totalSalidas:', totalSalidas)
    console.log('lowStock:', lowStock)
    if (filteredKardex.length) {
      console.log('sample filteredKardex[0]:', filteredKardex[0])
      console.log('tipos en filteredKardex:', [...new Set(filteredKardex.map(r=>r.tipo))])
    }
    if (lowStock.length) console.log('lowStock[0]:', lowStock[0])
    console.groupEnd()
  }, [summary, totalProducts, totalStock, kardex, filteredKardex, totalEntradas, totalSalidas, lowStock])

  const periodLabel = PERIODS.find(p=>p.key===period)?.label
  const hora   = new Date().getHours()
  const saludo = hora<12?'Buenos días':hora<18?'Buenas tardes':'Buenas noches'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 pt-6 pb-4 flex items-center justify-between"
        style={{opacity:headerVis?1:0,transform:headerVis?'translateY(0)':'translateY(-10px)',
          transition:'opacity .4s ease,transform .4s ease'}}>
        <div>
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-primary"/>
            <h1 className="text-foreground font-semibold text-base">
              {saludo}, {user?.nombre?.split(' ')[0] || 'usuario'}
            </h1>
          </div>
          <p className="text-muted text-xs mt-0.5">
            {new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1">
            {PERIODS.map(p=>(
              <button key={p.key} onClick={()=>setPeriod(p.key)}
                className="text-xs px-3 py-1 rounded-md transition-all duration-200"
                style={{background:period===p.key?'#f0883e18':'transparent',
                  color:period===p.key?'#f0883e':'#8b949e',fontWeight:period===p.key?600:400}}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={handleRefresh}
            className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-foreground transition-all">
            <RefreshCw size={13} className={refreshing?'animate-spin':''}/>
          </button>
        </div>
      </div>

      <div className="px-6 pb-8 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard icon={Package}     label="Productos activos" value={totalProducts}                        sub="en catálogo"      color="#f0883e"  delay={0}   loading={loadingSummary  && totalProducts===null}/>
          <KpiCard icon={Warehouse}   label="Unidades en stock" value={totalStock!==null?Math.round(totalStock):null} sub="disponible neto" color="#3fb950"  delay={80}  loading={loadingSummary  && totalStock===null}   sparkData={sparkEntrada}/>
          <KpiCard icon={TrendingUp}  label="Entradas"          value={Math.round(totalEntradas)}            sub={`en ${periodLabel}`} trend="up"   color="#79c0ff"  delay={160} loading={loadingKardex   && !kardex?.length}     sparkData={sparkEntrada}/>
          <KpiCard icon={TrendingDown}label="Salidas"           value={Math.round(totalSalidas)}             sub={`en ${periodLabel}`} trend="down" color="#d2a8ff"  delay={240} loading={loadingKardex   && !kardex?.length}     sparkData={sparkSalida}/>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-surface border border-border rounded-xl p-5"
            style={{animation:'fadeSlideUp .5s ease .3s both'}}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-primary"/>
                <span className="text-subtle text-sm font-semibold">Actividad del inventario</span>
              </div>
              <span className="text-muted text-xs">{periodLabel}</span>
            </div>
            <ActivityChart data={filteredKardex} loading={loadingKardex && !kardex?.length}/>
          </div>

          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col"
            style={{animation:'fadeSlideUp .5s ease .4s both'}}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-amber-400"/>
                <span className="text-subtle text-sm font-semibold">Aprobaciones</span>
              </div>
              {approvals.length>0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-400 font-semibold">
                  {approvals.length}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto max-h-44">
              {appLoading && !approvals.length ? (
                <div className="space-y-2">{[1,2,3].map(i=><Sk key={i} className="h-8 w-full"/>)}</div>
              ) : approvals.length===0 ? (
                <div className="flex flex-col items-center justify-center h-24 gap-2">
                  <CheckCircle size={20} className="text-emerald-400/60"/>
                  <span className="text-muted text-xs">Sin pendientes</span>
                </div>
              ) : approvals.slice(0,8).map((item,i)=>(
                <ApprovalRow key={item.id} item={item} index={i} onNavigate={()=>navigate('/aprobaciones')}/>
              ))}
            </div>
            {approvals.length>0 && (
              <button onClick={()=>navigate('/aprobaciones')}
                className="mt-3 flex items-center justify-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors py-1.5 border-t border-border/40">
                Ver todas <ArrowRight size={11}/>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-surface border border-border rounded-xl p-5"
            style={{animation:'fadeSlideUp .5s ease .5s both'}}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BarChart3 size={14} className="text-primary"/>
                <span className="text-subtle text-sm font-semibold">Movimientos recientes</span>
              </div>
              <span className="text-muted text-xs">{filteredKardex.length} mov.</span>
            </div>
            {loadingKardex && !kardex?.length ? (
              <div className="space-y-2">{[1,2,3,4,5].map(i=><Sk key={i} className="h-7 w-full"/>)}</div>
            ) : filteredKardex.length===0 ? (
              <div className="text-center text-muted text-xs py-6">Sin movimientos en el período</div>
            ) : filteredKardex.slice(0,8).map((row,i)=>(
              <KardexRow key={row.id||i} row={row} index={i}/>
            ))}
          </div>

          <div className="bg-surface border border-border rounded-xl p-5"
            style={{animation:'fadeSlideUp .5s ease .6s both'}}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-400"/>
                <span className="text-subtle text-sm font-semibold">Stock bajo mínimo</span>
              </div>
              {lowStock.length>0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-400/15 text-red-400 font-semibold">
                  {lowStock.length}
                </span>
              )}
            </div>
            {loadingLowStock && !lowStock.length ? (
              <div className="space-y-2">{[1,2,3].map(i=><Sk key={i} className="h-10 w-full"/>)}</div>
            ) : lowStock.length===0 ? (
              <div className="flex flex-col items-center justify-center h-24 gap-2">
                <CheckCircle size={20} className="text-emerald-400/60"/>
                <span className="text-muted text-xs">Todo el stock en niveles normales</span>
              </div>
            ) : lowStock.slice(0,6).map((item,i)=>(
              <StockAlert key={item.producto?.id||i} item={item} index={i}/>
            ))}
            {lowStock.length>0 && (
              <button onClick={()=>navigate('/inventario')}
                className="mt-3 flex items-center justify-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors py-1.5 border-t border-border/40">
                Ver inventario <ArrowRight size={11}/>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"
          style={{animation:'fadeSlideUp .5s ease .7s both'}}>
          {[
            {icon:Warehouse,     label:'Recepciones',  to:'/recepciones',  color:'#3fb950'},
            {icon:Truck,         label:'Despachos',     to:'/despachos',    color:'#f0883e'},
            {icon:Package,       label:'Inventario',    to:'/inventario',   color:'#79c0ff'},
            {icon:ClipboardList, label:'Aprobaciones',  to:'/aprobaciones', color:'#d2a8ff', badge:approvals.length||null},
          ].map(({icon:Icon,label,to,color,badge})=>(
            <button key={to} onClick={()=>navigate(to)}
              className="flex items-center gap-2.5 p-3.5 bg-surface border border-border rounded-xl text-muted hover:text-foreground group transition-all duration-200"
              onMouseEnter={e=>{e.currentTarget.style.borderColor=`${color}60`;e.currentTarget.style.boxShadow=`0 0 12px ${color}10`}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor='';e.currentTarget.style.boxShadow=''}}>
              <div className="p-1.5 rounded-lg flex-shrink-0" style={{background:`${color}15`}}>
                <Icon size={13} style={{color}}/>
              </div>
              <span className="text-xs font-medium flex-1 text-left">{label}</span>
              {badge ? (
                <span className="text-xs px-1.5 py-0.5 rounded-full font-semibold"
                  style={{background:`${color}20`,color}}>{badge}</span>
              ) : (
                <ArrowRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{color}}/>
              )}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideUp {
          from{opacity:0;transform:translateY(12px)}
          to  {opacity:1;transform:translateY(0)}
        }
      `}</style>
    </div>
  )
}
