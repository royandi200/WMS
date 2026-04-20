import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInventoryStore }  from '../store/inventoryStore'
import { useApprovalsStore }  from '../store/approvalsStore'
import { useAuthStore }       from '../store/authStore'
import { useProductionStore } from '../store/productionStore'
import {
  Package, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle, Clock, ArrowRight, RefreshCw,
  BarChart3, Truck, Warehouse, ClipboardList,
  Activity, ChevronRight, Zap, Factory, Trash2,
  ShieldCheck, Wifi, WifiOff,
} from 'lucide-react'

// ─── Utils ────────────────────────────────────────────────────────────────────
function periodStart(period) {
  const d = new Date()
  if (period === 'today') { d.setHours(0,0,0,0); return d }
  d.setDate(d.getDate() - (period === 'week' ? 7 : 30))
  d.setHours(0,0,0,0); return d
}
function fmtN(v, dec=0) {
  return v != null ? Number(v).toLocaleString('es-CO', {maximumFractionDigits:dec}) : '—'
}

// ─── AnimatedNumber ───────────────────────────────────────────────────────────
function AnimatedNumber({ value, duration=900 }) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef(null), prevRef = useRef(0)
  useEffect(() => {
    if (value == null) return
    const start = prevRef.current, end = Number(value)||0, t0 = performance.now()
    const ease = t => t<.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2
    const tick = now => {
      const p = Math.min((now-t0)/duration,1)
      setDisplay(Math.round(start+(end-start)*ease(p)))
      if (p<1) rafRef.current = requestAnimationFrame(tick)
      else prevRef.current = end
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])
  return <span>{display.toLocaleString('es-CO')}</span>
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data=[], color='#f0883e', h=36 }) {
  if (!data.length || data.every(v=>v===0)) return (
    <div className="flex items-end gap-0.5" style={{height:h}}>
      {Array.from({length:7}).map((_,i)=>(
        <div key={i} className="flex-1 rounded-sm bg-border/40" style={{height:'20%'}}/>
      ))}
    </div>
  )
  const w=100, min=Math.min(...data), max=Math.max(...data), range=max-min||1
  const pts = data.map((v,i)=>{
    const x=(i/(data.length-1))*w
    const y=h-((v-min)/range)*(h-2)-1
    return `${x},${y}`
  }).join(' ')
  const gid=`sg${color.replace('#','')}`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-80">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.4"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" points={pts}/>
      <polygon fill={`url(#${gid})`} points={`0,${h} ${pts} ${w},${h}`}/>
    </svg>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Sk({ className='', style={} }) {
  return <div className={`animate-pulse bg-white/5 rounded-md ${className}`} style={style}/>
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon:Icon, label, value, sub, color, trend, sparkData, delay=0, loading }) {
  const [vis, setVis] = useState(false)
  useEffect(()=>{ const t=setTimeout(()=>setVis(true),delay); return()=>clearTimeout(t) },[delay])
  if (loading) return (
    <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
      <Sk className="h-3 w-20"/><Sk className="h-7 w-14"/><Sk className="h-3 w-28"/>
    </div>
  )
  return (
    <div className="relative bg-surface border border-border rounded-xl p-5 flex flex-col gap-3 overflow-hidden group"
      style={{opacity:vis?1:0,transform:vis?'translateY(0)':'translateY(14px)',
        transition:`opacity .5s ease ${delay}ms,transform .5s ease ${delay}ms`}}
      onMouseEnter={e=>{
        e.currentTarget.style.borderColor=`${color}50`
        e.currentTarget.style.boxShadow=`0 0 0 1px ${color}20,0 8px 32px ${color}12`
      }}
      onMouseLeave={e=>{e.currentTarget.style.borderColor='';e.currentTarget.style.boxShadow=''}}>
      {/* bg glow */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{background:`radial-gradient(ellipse at top right,${color}08 0%,transparent 60%)`}}/>
      <div className="flex items-center justify-between relative z-10">
        <span className="text-muted text-[10px] font-semibold uppercase tracking-widest">{label}</span>
        <div className="p-1.5 rounded-lg" style={{background:`${color}15`}}>
          <Icon size={13} style={{color}}/>
        </div>
      </div>
      <div className="flex items-end justify-between gap-2 relative z-10">
        <div>
          <div className="text-foreground text-2xl font-bold tabular-nums leading-none">
            <AnimatedNumber value={value??0}/>
          </div>
          {sub && (
            <div className={`flex items-center gap-1 mt-1.5 text-xs ${
              trend==='up'?'text-emerald-400':trend==='down'?'text-red-400':'text-muted'}`}>
              {trend==='up'&&<TrendingUp size={10}/>}
              {trend==='down'&&<TrendingDown size={10}/>}
              {sub}
            </div>
          )}
        </div>
        {sparkData && <Sparkline data={sparkData} color={color}/>}
      </div>
    </div>
  )
}

// ─── Flow Node (plano de bodega) ──────────────────────────────────────────────
function FlowNode({ icon:Icon, label, sublabel, color, count, countLabel, alert, pulse, href, delay=0 }) {
  const navigate = useNavigate()
  const [vis, setVis] = useState(false)
  useEffect(()=>{ const t=setTimeout(()=>setVis(true),delay); return()=>clearTimeout(t) },[delay])
  return (
    <button onClick={()=>navigate(href)}
      className="relative flex flex-col items-center gap-2 group"
      style={{opacity:vis?1:0,transform:vis?'translateY(0)':'translateY(10px)',
        transition:`opacity .4s ease ${delay}ms,transform .4s ease ${delay}ms`}}>
      {/* Pulse ring si hay alerta */}
      {alert && (
        <span className="absolute -top-1 -right-1 z-20 w-3 h-3 rounded-full"
          style={{background:color,boxShadow:`0 0 0 0 ${color}`,
            animation:'alertPing 1.5s ease-in-out infinite'}}/>
      )}
      {/* Nodo */}
      <div className="relative w-12 h-12 md:w-16 md:h-16 rounded-2xl border-2 flex items-center justify-center transition-all duration-200 group-hover:scale-110"
        style={{
          background:`linear-gradient(135deg,${color}20,${color}08)`,
          borderColor:`${color}50`,
          boxShadow:`0 0 20px ${color}20`,
        }}>
        {pulse && (
          <div className="absolute inset-0 rounded-2xl animate-ping opacity-20"
            style={{background:color}}/>
        )}
        <Icon size={18} className="md:hidden" style={{color}}/>
        <Icon size={22} className="hidden md:block" style={{color}}/>
      </div>
      {/* Badge count */}
      {count != null && (
        <div className="absolute -bottom-1 -right-1 z-10 min-w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black px-1.5"
          style={{background:count>0?color:'#30363d',color:count>0?'#0d1117':'#8b949e'}}>
          {count}
        </div>
      )}
      <div className="text-center">
        <p className="text-xs font-semibold text-foreground leading-tight">{label}</p>
        {sublabel && <p className="text-[9px] text-muted mt-0.5 leading-tight">{sublabel}</p>}
        {countLabel && count > 0 && (
          <p className="text-[9px] font-bold mt-0.5" style={{color}}>{countLabel}</p>
        )}
      </div>
    </button>
  )
}

// ─── Flow Connector ───────────────────────────────────────────────────────────
function FlowLine({ animated=false, color='#30363d' }) {
  return (
    <div className="flex items-center justify-center flex-1 px-1" style={{marginBottom:'0px'}}>
      <div className="relative h-px flex-1" style={{background:color}}>
        {animated && (
          <div className="absolute inset-y-0 left-0 w-4 rounded-full"
            style={{background:`linear-gradient(90deg,transparent,${color},transparent)`,
              animation:'flowPulse 2s ease-in-out infinite'}}/>
        )}
        <div className="absolute right-0 top-1/2 -translate-y-1/2"
          style={{width:0,height:0,
            borderTop:'4px solid transparent',borderBottom:'4px solid transparent',
            borderLeft:`6px solid ${color}`}}/>
      </div>
    </div>
  )
}

// ─── Activity Chart ───────────────────────────────────────────────────────────
const TIPOS = ['entrada','salida','ajuste']
const COLORES = { entrada:'#3fb950', salida:'#f0883e', ajuste:'#d2a8ff' }
const LABELS  = { entrada:'Entrada', salida:'Salida',  ajuste:'Ajuste'  }

function ActivityChart({ data=[], loading }) {
  const [anim, setAnim] = useState(false)
  useEffect(()=>{
    setAnim(false)
    if (!loading&&data.length) { const t=setTimeout(()=>setAnim(true),150); return()=>clearTimeout(t) }
  },[loading,data])
  const days = Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(6-i)); return d.toISOString().split('T')[0]
  })
  const grouped = days.map(day=>{
    const rows = data.filter(r=>(r.fecha||'').startsWith(day))
    return {
      day:     day.slice(5),
      entrada: rows.filter(r=>r.tipo==='entrada').reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0),
      salida:  rows.filter(r=>r.tipo==='salida') .reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0),
      ajuste:  rows.filter(r=>r.tipo==='ajuste') .reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0),
    }
  })
  const maxVal = Math.max(...grouped.flatMap(g=>TIPOS.map(t=>g[t])),1)
  if (loading) return (
    <div className="flex items-end gap-2 h-28">
      {[40,70,55,80,45,65,90].map((h,i)=><Sk key={i} className="flex-1" style={{height:`${h}%`}}/>)}
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1.5" style={{height:'112px'}}>
        {grouped.map((g,gi)=>(
          <div key={g.day} className="flex-1 flex flex-col items-center" style={{height:'112px'}}>
            <div className="w-full flex flex-col-reverse gap-0.5 overflow-hidden" style={{height:'88px',justifyContent:'flex-end',display:'flex',flexDirection:'column-reverse'}}>
              {TIPOS.map(tipo=>(
                <div key={tipo}
                  title={`${LABELS[tipo]}: ${g[tipo]}`}
                  className="w-full rounded-sm transition-all duration-700 flex-shrink-0"
                  style={{
                    height:anim?`${Math.max((g[tipo]/maxVal)*88,g[tipo]>0?3:0)}px`:'0px',
                    maxHeight:'88px',
                    background:COLORES[tipo],opacity:g[tipo]>0?.9:0,
                    transitionDelay:`${gi*60}ms`,
                    boxShadow:g[tipo]>0?`0 0 6px ${COLORES[tipo]}50`:'none',
                  }}/>
              ))}
            </div>
            <span className="text-muted text-[10px] mt-1.5 shrink-0">{g.day}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 pt-1 border-t border-border/40">
        {TIPOS.map(t=>(
          <div key={t} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm" style={{background:COLORES[t]}}/>
            <span className="text-muted text-[10px]">{LABELS[t]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Kardex Row ───────────────────────────────────────────────────────────────
const TIPO_META = {
  entrada:  {label:'Entrada',  color:'#3fb950',bg:'#3fb95018'},
  salida:   {label:'Salida',   color:'#f0883e',bg:'#f0883e18'},
  merma:    {label:'Merma',    color:'#f85149',bg:'#f8514918'},
  traslado: {label:'Traslado', color:'#79c0ff',bg:'#79c0ff18'},
  ajuste:   {label:'Ajuste',   color:'#d2a8ff',bg:'#d2a8ff18'},
}
function KardexRow({ row, index }) {
  const [vis, setVis] = useState(false)
  useEffect(()=>{ const t=setTimeout(()=>setVis(true),50*index); return()=>clearTimeout(t) },[index])
  const meta  = TIPO_META[(row.tipo||'').toLowerCase()] || {label:row.tipo,color:'#8b949e',bg:'#8b949e18'}
  const fecha = row.fecha ? new Date(row.fecha).toLocaleDateString('es-CO',{day:'2-digit',month:'short'}) : '--'
  const label = row.sku || row.producto || row.producto_id || '—'
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/30 last:border-0"
      style={{opacity:vis?1:0,transform:vis?'translateX(0)':'translateX(-8px)',
        transition:`opacity .3s ease ${50*index}ms,transform .3s ease ${50*index}ms`}}>
      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:meta.color}}/>
      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{color:meta.color,background:meta.bg}}>
        {meta.label}
      </span>
      <span className="text-subtle text-xs flex-1 truncate font-mono">{label}</span>
      <span className="text-muted text-xs tabular-nums font-mono">
        {Number(row.cantidad)>0?'+':''}{fmtN(row.cantidad)}
      </span>
      <span className="text-muted text-[10px] w-12 text-right shrink-0">{fecha}</span>
    </div>
  )
}

// ─── Stock Alert Row ──────────────────────────────────────────────────────────
function StockAlert({ item, index }) {
  const [vis, setVis] = useState(false)
  useEffect(()=>{ const t=setTimeout(()=>setVis(true),70*index); return()=>clearTimeout(t) },[index])
  const nombre   = item.name || item.sku || '—'
  const stockMin = parseFloat(item.min_stock||0)
  const stockAct = parseFloat(item.disponible||item.stock||0)
  const pct      = stockMin>0 ? Math.min((stockAct/stockMin)*100,100) : 0
  const critical = pct<30
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/30 last:border-0"
      style={{opacity:vis?1:0,transform:vis?'translateY(0)':'translateY(6px)',
        transition:`opacity .4s ease ${70*index}ms,transform .4s ease ${70*index}ms`}}>
      <AlertTriangle size={12} className={critical?'text-red-400 shrink-0':'text-amber-400 shrink-0'}/>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-subtle text-xs truncate font-medium">{nombre}</span>
          <span className="text-muted text-[10px] tabular-nums font-mono shrink-0 ml-2">
            {fmtN(stockAct)} / {fmtN(stockMin)}
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

// ─── Approval Row ─────────────────────────────────────────────────────────────
const ACCION_COLOR = {DESPACHO:'#f0883e',RECEPCION:'#3fb950',MERMA:'#f85149',PRODUCCION:'#79c0ff'}
function ApprovalRow({ item, index, onNavigate }) {
  const [vis, setVis] = useState(false)
  useEffect(()=>{ const t=setTimeout(()=>setVis(true),60*index); return()=>clearTimeout(t) },[index])
  const color = '#d2a8ff'
  const label = item.producto_nombre || item.producto || item.siigo_code || `Ajuste #${String(item.id).slice(0,8)}`
  const sub   = item.bodega_orig_nombre ? `${item.bodega_orig_nombre}` : item.usuario_nombre || 'ajuste'
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/30 last:border-0 cursor-pointer group"
      style={{opacity:vis?1:0,transform:vis?'translateX(0)':'translateX(8px)',
        transition:`opacity .4s ease ${60*index}ms,transform .4s ease ${60*index}ms`}}
      onClick={onNavigate}>
      <div className="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{background:color}}/>
      <div className="flex-1 min-w-0">
        <div className="text-subtle text-xs font-medium truncate">{label}</div>
        <div className="text-muted text-[10px]">{sub} · {Number(item.cantidad||0).toLocaleString('es-CO')} u.</div>
      </div>
      <ChevronRight size={11} className="text-muted group-hover:text-primary transition-colors"/>
    </div>
  )
}

// ─── Live Ticker ──────────────────────────────────────────────────────────────
function LiveTicker({ lastUpdate, refreshing }) {
  const [tick, setTick] = useState(0)
  useEffect(()=>{ const iv=setInterval(()=>setTick(t=>t+1),1000); return()=>clearInterval(iv) },[])
  const secs = Math.floor((Date.now() - lastUpdate)/1000)
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted">
      {refreshing
        ? <><RefreshCw size={10} className="animate-spin text-primary"/><span className="text-primary">Actualizando…</span></>
        : <><div className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{animation:'liveDot 2s ease-in-out infinite'}}/><span>hace {secs<5?'ahora':secs<60?`${secs}s`:`${Math.floor(secs/60)}m`}</span></>
      }
    </div>
  )
}

// ─── PERIODS ──────────────────────────────────────────────────────────────────
const PERIODS = [{key:'today',label:'Hoy'},{key:'week',label:'7 días'},{key:'month',label:'30 días'}]

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate()
  const { user }  = useAuthStore()
  const {
    summary, lowStock, kardex,
    loadingSummary, loadingKardex, loadingLowStock,
    fetchSummary, fetchLowStock, fetchKardex,
  } = useInventoryStore()
  const { list:approvals,  loading:appLoading,  fetchList:fetchApprovals  } = useApprovalsStore()
  const { list:prodList,   loading:prodLoading,  fetchList:fetchProd       } = useProductionStore()

  const [period,     setPeriod]     = useState('week')
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(Date.now())
  const [headerVis,  setHeaderVis]  = useState(false)

  const loadAll = useCallback(async () => {
    await Promise.all([
      fetchSummary(),
      fetchLowStock(),
      fetchKardex({ limit:200, page:1 }),
      fetchApprovals({ estado:'PENDIENTE', limit:10 }),
      fetchProd({}).catch(()=>{}),

    ])
    setLastUpdate(Date.now())
  }, [fetchSummary,fetchLowStock,fetchKardex,fetchApprovals,fetchProd])

  useEffect(()=>{ loadAll(); setTimeout(()=>setHeaderVis(true),50) },[]) // eslint-disable-line

  // Auto-refresh cada 30s
  useEffect(()=>{
    const iv = setInterval(()=>{ loadAll() }, 30000)
    return ()=>clearInterval(iv)
  },[loadAll])

  const handleRefresh = async () => { setRefreshing(true); await loadAll(); setRefreshing(false) }

  // ── KPIs derivados ──────────────────────────────────────────────────────────
  const filteredKardex = useMemo(()=>{
    if (!Array.isArray(kardex)||!kardex.length) return []
    const since = periodStart(period)
    return kardex.filter(r=>r.fecha && new Date(r.fecha)>=since)
  },[kardex,period])

  const totalProducts = useMemo(()=>summary?(summary.productos_activos??summary.total_productos??0):null,[summary])
  const totalStock    = useMemo(()=>summary?(summary.disponible??summary.total_unidades??0):null,[summary])
  const totalEntradas = useMemo(()=>filteredKardex.filter(r=>r.tipo==='entrada').reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0),[filteredKardex])
  const totalSalidas  = useMemo(()=>filteredKardex.filter(r=>r.tipo==='salida') .reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0),[filteredKardex])
  const sparkEntrada  = useMemo(()=>Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(6-i)); const day=d.toISOString().split('T')[0]; return (kardex||[]).filter(r=>r.tipo==='entrada'&&(r.fecha||'').startsWith(day)).reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0) }),[kardex])
  const sparkSalida   = useMemo(()=>Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(6-i)); const day=d.toISOString().split('T')[0]; return (kardex||[]).filter(r=>r.tipo==='salida'&&(r.fecha||'').startsWith(day)) .reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0) }),[kardex])

  const safeProd      = Array.isArray(prodList)  ? prodList  : []
  const safeApprovals = Array.isArray(approvals) ? approvals : []
  const prodActivas  = safeProd.filter(o=>['en_proceso','pendiente'].includes(o.status)).length
  const today         = new Date().toISOString().split('T')[0]
  const wasteTotalHoy = Array.isArray(kardex) ? kardex.filter(r=>r.tipo==='merma'&&(r.fecha||'').startsWith(today)).length : 0
  const wasteTotal    = Array.isArray(kardex) ? kardex.filter(r=>r.tipo==='merma').reduce((s,r)=>s+Math.abs(Number(r.cantidad||0)),0) : 0

  const periodLabel = PERIODS.find(p=>p.key===period)?.label
  const hora   = new Date().getHours()
  const saludo = hora<12?'Buenos días':hora<18?'Buenas tardes':'Buenas noches'

  // ── Flow nodes ──────────────────────────────────────────────────────────────
  const flowNodes = [
    {
      icon:Truck, label:'Recepciones', sublabel:'Entrada de mercancía',
      color:'#58a6ff', count: Array.isArray(kardex) ? kardex.filter(r=>r.tipo==='entrada'&&(r.fecha||'').startsWith(today)).length || null : null,
      countLabel:'hoy', alert:false,
      pulse:totalEntradas>0, href:'/recepciones', delay:100,
    },
    {
      icon:Warehouse, label:'Almacén', sublabel:'Stock disponible',
      color:'#3fb950', count:lowStock.length||null,
      countLabel:'bajo mínimo', alert:lowStock.length>0,
      pulse:lowStock.length>0, href:'/inventario', delay:180,
    },
    {
      icon:Factory, label:'Producción', sublabel:'Órdenes activas',
      color:'#f0883e', count:prodActivas||null,
      countLabel:'en proceso', alert:false,
      pulse:prodActivas>0, href:'/produccion', delay:260,
    },
    {
      icon:Trash2, label:'Mermas', sublabel:`Total: ${fmtN(wasteTotal)} u.`,
      color:'#f85149', count:wasteTotalHoy||null,
      countLabel:'mov. hoy', alert:wasteTotalHoy>0,
      pulse:false, href:'/mermas', delay:340,
    },
    {
      icon:ClipboardList, label:'Aprobaciones', sublabel:'Ajustes pendientes SIIGO',
      color:'#d2a8ff', count:safeApprovals.length||null,
      countLabel:'pendientes', alert:safeApprovals.length>0,
      pulse:safeApprovals.length>0, href:'/aprobaciones', delay:420,
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <style>{`
        @keyframes fadeSlideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes alertPing   { 0%,100%{box-shadow:0 0 0 0 currentColor} 50%{box-shadow:0 0 0 6px transparent} }
        @keyframes flowPulse   { 0%{left:0;opacity:0} 50%{opacity:1} 100%{left:100%;opacity:0} }
        @keyframes liveDot     { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes scanline    { 0%{transform:translateY(-100%)} 100%{transform:translateY(400%)} }
        .flow-active { animation: flowPulse 2s ease-in-out infinite; }
      `}</style>

      {/* ── HEADER ── */}
      <div className="px-6 pt-6 pb-4 flex items-center justify-between"
        style={{opacity:headerVis?1:0,transform:headerVis?'translateY(0)':'translateY(-10px)',
          transition:'opacity .4s ease,transform .4s ease'}}>
        <div>
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-primary"/>
            <h1 className="text-foreground font-semibold text-base">
              {saludo}, {user?.nombre?.split(' ')[0]||'Admin'}
            </h1>
          </div>
          <p className="text-muted text-xs mt-0.5">
            {new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LiveTicker lastUpdate={lastUpdate} refreshing={refreshing}/>
          <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1">
            {PERIODS.map(p=>(
              <button key={p.key} onClick={()=>setPeriod(p.key)}
                className="text-xs px-2.5 md:px-3 py-1 rounded-md transition-all duration-200"
                style={{background:period===p.key?'#f0883e15':'transparent',
                  color:period===p.key?'#f0883e':'#8b949e',fontWeight:period===p.key?600:400}}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={handleRefresh}
            className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-foreground hover:border-primary/40 transition-all">
            <RefreshCw size={13} className={refreshing?'animate-spin':''}/>
          </button>
        </div>
      </div>

      <div className="px-6 pb-8 space-y-5">

        {/* ── PLANO DE FLUJO ── */}
        <div className="relative bg-surface border border-border rounded-xl p-5 overflow-hidden"
          style={{animation:'fadeSlideUp .5s ease .1s both'}}>

          {/* Scanline effect */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl opacity-[0.03]">
            <div className="absolute w-full h-16 bg-gradient-to-b from-transparent via-foreground to-transparent"
              style={{animation:'scanline 8s linear infinite'}}/>
          </div>

          {/* Grid dots background */}
          <div className="absolute inset-0 rounded-xl opacity-[0.04]"
            style={{backgroundImage:'radial-gradient(circle,#e6edf3 1px,transparent 1px)',backgroundSize:'24px 24px'}}/>

          <div className="relative z-10">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <ShieldCheck size={13} className="text-primary"/>
                <span className="text-subtle text-sm font-semibold">Plano de operaciones</span>
                <span className="text-[9px] text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider">
                  LIVE
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted">
                <Wifi size={10} className="text-emerald-400"/>
                <span>En tiempo real</span>
              </div>
            </div>

            {/* Flujo: nodos + conectores */}
            <div className="flex items-center justify-between overflow-x-auto pb-2 -mx-1 px-1 gap-1 md:gap-0">
              {flowNodes.map((node, i) => (
                <div key={node.label} className="flex items-start" style={{flex:1}}>
                  <FlowNode {...node}/>
                  {i < flowNodes.length-1 && (
                    <FlowLine
                      animated={node.pulse || node.count > 0}
                      color={node.count>0 ? node.color+'60' : '#30363d'}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Indicador de estado global */}
            <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border/40">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-400" style={{animation:'liveDot 2s ease-in-out infinite'}}/>
                <span className="text-[10px] text-muted">Sistema operativo</span>
              </div>
              <div className="h-3 w-px bg-border"/>
              <span className="hidden sm:inline text-[10px] text-muted">{prodActivas} órdenes activas</span>
              <div className="hidden sm:block h-3 w-px bg-border"/>
              <span className="text-[10px] text-muted">{fmtN(totalStock)} u. en stock</span>
              {lowStock.length > 0 && <>
                <div className="h-3 w-px bg-border"/>
                <span className="text-[10px] text-red-400 font-semibold">⚠ {lowStock.length} bajo mínimo</span>
              </>}
              {safeApprovals.length > 0 && <>
                <div className="h-3 w-px bg-border"/>
                <span className="text-[10px] text-amber-400 font-semibold">{safeApprovals.length} aprobaciones pendientes</span>
              </>}
            </div>
          </div>
        </div>

        {/* ── KPI CARDS ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard icon={Package}      label="Productos activos" value={totalProducts}                           sub="en catálogo"       color="#f0883e"  delay={0}   loading={loadingSummary&&totalProducts===null}/>
          <KpiCard icon={Warehouse}    label="Unidades en stock" value={totalStock!=null?Math.round(totalStock):null} sub="disponible neto"  color="#3fb950"  delay={80}  loading={loadingSummary&&totalStock===null}/>
          <KpiCard icon={TrendingUp}   label="Entradas"          value={Math.round(totalEntradas)}               sub={`en ${periodLabel}`} trend="up"  color="#79c0ff"  delay={160} loading={loadingKardex&&!kardex?.length} sparkData={sparkEntrada}/>
          <KpiCard icon={TrendingDown} label="Salidas"           value={Math.round(totalSalidas)}                sub={`en ${periodLabel}`} trend="down" color="#d2a8ff" delay={240} loading={loadingKardex&&!kardex?.length} sparkData={sparkSalida}/>
        </div>

        {/* ── GRÁFICO + APROBACIONES ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4">
          <div className="lg:col-span-2 bg-surface border border-border rounded-xl p-5"
            style={{animation:'fadeSlideUp .5s ease .35s both'}}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity size={13} className="text-primary"/>
                <span className="text-subtle text-sm font-semibold">Actividad del inventario</span>
              </div>
              <span className="text-muted text-xs">{periodLabel}</span>
            </div>
            <ActivityChart data={filteredKardex} loading={loadingKardex&&!kardex?.length}/>
          </div>

          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col"
            style={{animation:'fadeSlideUp .5s ease .45s both'}}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock size={13} className="text-amber-400"/>
                <span className="text-subtle text-sm font-semibold">Aprobaciones</span>
              </div>
              {safeApprovals.length>0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-400 font-bold">
                  {safeApprovals.length}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto max-h-44 min-h-0">
              {appLoading&&!safeApprovals.length
                ? <div className="space-y-2">{[1,2,3].map(i=><Sk key={i} className="h-8 w-full"/>)}</div>
                : safeApprovals.length===0
                  ? <div className="flex flex-col items-center justify-center h-24 gap-2">
                      <CheckCircle size={20} className="text-emerald-400/50"/>
                      <span className="text-muted text-xs">Sin pendientes</span>
                    </div>
                  : safeApprovals.slice(0,8).map((item,i)=>(
                      <ApprovalRow key={item.id} item={item} index={i} onNavigate={()=>navigate('/aprobaciones')}/>
                    ))
              }
            </div>
            {safeApprovals.length>0 && (
              <button onClick={()=>navigate('/aprobaciones')}
                className="mt-3 flex items-center justify-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors py-1.5 border-t border-border/40">
                Ver todas <ArrowRight size={11}/>
              </button>
            )}
          </div>
        </div>

        {/* ── MOVIMIENTOS + STOCK BAJO ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-surface border border-border rounded-xl p-5"
            style={{animation:'fadeSlideUp .5s ease .55s both'}}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BarChart3 size={13} className="text-primary"/>
                <span className="text-subtle text-sm font-semibold">Movimientos recientes</span>
              </div>
              <span className="text-muted text-[10px] font-mono">{filteredKardex.length} mov.</span>
            </div>
            {loadingKardex&&!kardex?.length
              ? <div className="space-y-2">{[1,2,3,4,5].map(i=><Sk key={i} className="h-7 w-full"/>)}</div>
              : filteredKardex.length===0
                ? <div className="text-center text-muted text-xs py-8">Sin movimientos en el período</div>
                : filteredKardex.slice(0,8).map((row,i)=>(
                    <KardexRow key={row.movimiento_id||i} row={row} index={i}/>
                  ))
            }
          </div>

          <div className="bg-surface border border-border rounded-xl p-5"
            style={{animation:'fadeSlideUp .5s ease .65s both'}}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={13} className="text-amber-400"/>
                <span className="text-subtle text-sm font-semibold">Stock bajo mínimo</span>
              </div>
              {lowStock.length>0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-400/15 text-red-400 font-bold">
                  {lowStock.length}
                </span>
              )}
            </div>
            {loadingLowStock&&!lowStock.length
              ? <div className="space-y-2">{[1,2,3].map(i=><Sk key={i} className="h-10 w-full"/>)}</div>
              : lowStock.length===0
                ? <div className="flex flex-col items-center justify-center h-24 gap-2">
                    <CheckCircle size={20} className="text-emerald-400/50"/>
                    <span className="text-muted text-xs">Todo el stock en niveles normales</span>
                  </div>
                : lowStock.slice(0,6).map((item,i)=>(
                    <StockAlert key={item.id||i} item={item} index={i}/>
                  ))
            }
            {lowStock.length>0 && (
              <button onClick={()=>navigate('/inventario')}
                className="mt-3 flex items-center justify-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors py-1.5 border-t border-border/40">
                Ver inventario <ArrowRight size={11}/>
              </button>
            )}
          </div>
        </div>

        {/* ── ACCESOS RÁPIDOS ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"
          style={{animation:'fadeSlideUp .5s ease .75s both'}}>
          {[
            {icon:Warehouse,     label:'Recepciones',  to:'/recepciones',  color:'#3fb950'},
            {icon:Truck,         label:'Despachos',     to:'/despachos',    color:'#f0883e'},
            {icon:Package,       label:'Inventario',    to:'/inventario',   color:'#79c0ff'},
            {icon:ClipboardList, label:'Aprobaciones',  to:'/aprobaciones', color:'#d2a8ff', badge:safeApprovals.length||null},
          ].map(({icon:Icon,label,to,color,badge})=>(
            <button key={to} onClick={()=>navigate(to)}
              className="flex items-center gap-2.5 p-3.5 bg-surface border border-border rounded-xl text-muted hover:text-foreground group transition-all duration-200"
              onMouseEnter={e=>{e.currentTarget.style.borderColor=`${color}60`;e.currentTarget.style.boxShadow=`0 0 16px ${color}10`}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor='';e.currentTarget.style.boxShadow=''}}>
              <div className="p-1.5 rounded-lg shrink-0" style={{background:`${color}15`}}>
                <Icon size={13} style={{color}}/>
              </div>
              <span className="text-xs font-medium flex-1 text-left">{label}</span>
              {badge
                ? <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{background:`${color}20`,color}}>{badge}</span>
                : <ArrowRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{color}}/>
              }
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
