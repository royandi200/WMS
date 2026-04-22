import { useEffect, useState, useMemo } from 'react'
import { useInventoryStore } from '../store/inventoryStore'
import { Package, X, Search, AlertTriangle, CheckCircle, Box, RefreshCw, Layers } from 'lucide-react'

// ─── Colores por estado ───────────────────────────────────────────────────────
const ESTADO = {
  ok:    { bg:'#3fb95018', border:'#3fb95050', dot:'#3fb950', label:'Con stock',  icon:'✓' },
  bajo:  { bg:'#f0883e18', border:'#f0883e50', dot:'#f0883e', label:'Bajo mín.',  icon:'⚠' },
  vacio: { bg:'#ffffff06', border:'#30363d',   dot:'#8b949e', label:'Vacía',      icon:'○' },
}

// ─── Celda de ubicación ───────────────────────────────────────────────────────
function UbicCell({ ub, selected, onClick }) {
  const e = ESTADO[ub.estado] || ESTADO.vacio
  return (
    <button
      onClick={() => onClick(ub)}
      title={`${ub.codigo} · ${ub.estado === 'vacio' ? 'Vacía' : ub.cantidad_total + ' u.'}`}
      className="relative flex flex-col items-center justify-center rounded-lg border transition-all duration-150 active:scale-95 group"
      style={{
        width: '52px', height: '52px',
        background:   selected ? e.dot + '30' : e.bg,
        borderColor:  selected ? e.dot        : e.border,
        boxShadow:    selected ? `0 0 0 2px ${e.dot}60` : 'none',
      }}>
      {/* Dot estado */}
      <div className="w-2 h-2 rounded-full mb-1" style={{ background: e.dot }}/>
      {/* Código corto */}
      <span className="text-[9px] font-mono font-bold leading-none"
        style={{ color: ub.estado === 'vacio' ? '#8b949e' : '#e6edf3' }}>
        {ub.codigo.split('-').slice(-1)[0] || ub.codigo}
      </span>
      {/* Cantidad */}
      {ub.estado !== 'vacio' && (
        <span className="text-[8px] tabular-nums mt-0.5" style={{ color: e.dot }}>
          {ub.cantidad_total >= 1000
            ? (ub.cantidad_total / 1000).toFixed(1) + 'k'
            : Math.round(ub.cantidad_total)}
        </span>
      )}
    </button>
  )
}

// ─── Panel detalle ────────────────────────────────────────────────────────────
function DetailPanel({ ub, onClose }) {
  if (!ub) return null
  const e = ESTADO[ub.estado] || ESTADO.vacio
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col"
      style={{ minWidth: '260px', maxWidth: '300px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: e.dot }}/>
          <span className="text-sm font-bold text-foreground font-mono">{ub.codigo}</span>
        </div>
        <button onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-white/8 transition-colors">
          <X size={13}/>
        </button>
      </div>

      {/* Meta */}
      <div className="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-b border-border/50">
        {[
          ['Bodega',   ub.bodega_nombre || ub.bodega_codigo],
          ['Zona',     ub.zona],
          ['Pasillo',  ub.pasillo],
          ['Nivel',    ub.nivel],
          ['Estado',   e.label],
          ['Productos',ub.num_productos > 0 ? ub.num_productos : '—'],
        ].map(([k,v]) => (
          <div key={k}>
            <p className="text-[9px] text-muted uppercase tracking-wider">{k}</p>
            <p className="text-xs font-medium text-subtle">{v}</p>
          </div>
        ))}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto max-h-64">
        {ub.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <Box size={20} className="text-muted opacity-40"/>
            <span className="text-xs text-muted">Ubicación vacía</span>
          </div>
        ) : ub.items.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/30 last:border-0 hover:bg-white/3 transition-colors">
            <div className="min-w-0">
              <p className="text-xs font-mono text-primary truncate">{item.sku}</p>
              <p className="text-[10px] text-muted truncate">{item.nombre}</p>
              {item.lote !== '—' && (
                <p className="text-[9px] text-muted/60">Lote: {item.lote}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold tabular-nums" style={{ color: e.dot }}>
                {Number(item.cantidad).toLocaleString('es-CO', { maximumFractionDigits: 1 })}
              </p>
              <p className="text-[9px] text-muted">u.</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── MAPA PRINCIPAL ───────────────────────────────────────────────────────────
export default function MapaBodega() {
  const { mapa, loadingMapa, fetchMapa } = useInventoryStore()
  const [selected,    setSelected]    = useState(null)
  const [filterZona,  setFilterZona]  = useState('')
  const [filterBodega,setFilterBodega]= useState('')
  const [filterEstado,setFilterEstado]= useState('')
  const [search,      setSearch]      = useState('')

  useEffect(() => { fetchMapa() }, [])

  const ubicaciones = mapa?.ubicaciones ?? []
  const bodegas      = mapa?.bodegas      ?? []

  // Zonas únicas de la bodega seleccionada
  const zonas = useMemo(() => {
    const base = filterBodega
      ? ubicaciones.filter(u => String(u.bodega_id) === filterBodega)
      : ubicaciones
    return [...new Set(base.map(u => u.zona))].sort()
  }, [ubicaciones, filterBodega])

  // Filtrado
  const filtered = useMemo(() => {
    return ubicaciones.filter(u => {
      if (filterBodega && String(u.bodega_id) !== filterBodega) return false
      if (filterZona   && u.zona    !== filterZona)             return false
      if (filterEstado && u.estado  !== filterEstado)           return false
      if (search) {
        const q = search.toLowerCase()
        const matchCod  = u.codigo.toLowerCase().includes(q)
        const matchSKU  = u.items.some(it => it.sku?.toLowerCase().includes(q) || it.nombre?.toLowerCase().includes(q))
        if (!matchCod && !matchSKU) return false
      }
      return true
    })
  }, [ubicaciones, filterBodega, filterZona, filterEstado, search])

  // Estadísticas
  const stats = useMemo(() => ({
    total: filtered.length,
    ok:    filtered.filter(u => u.estado === 'ok').length,
    bajo:  filtered.filter(u => u.estado === 'bajo').length,
    vacio: filtered.filter(u => u.estado === 'vacio').length,
  }), [filtered])

  // Agrupar por zona → pasillo
  const grouped = useMemo(() => {
    const g = {}
    for (const u of filtered) {
      if (!g[u.zona]) g[u.zona] = {}
      const p = u.pasillo || '—'
      if (!g[u.zona][p]) g[u.zona][p] = []
      g[u.zona][p].push(u)
    }
    return g
  }, [filtered])

  // ── MOCK si no hay datos ───────────────────────────────────────────────────
  const MOCK = useMemo(() => {
    if (ubicaciones.length > 0) return null
    const estados = ['ok','ok','ok','bajo','vacio','ok','vacio','bajo']
    const mock = []
    let id = 1
    for (const zona of ['A','B','C']) {
      for (const pasillo of ['01','02']) {
        for (const nivel of ['1','2','3']) {
          for (const pos of ['a','b']) {
            const est = estados[(id-1) % estados.length]
            mock.push({
              id, codigo:`${zona}-${pasillo}-${nivel}${pos}`,
              zona:`Zona ${zona}`, pasillo, nivel, posicion:pos,
              bodega_id:1, bodega_codigo:'BPR', bodega_nombre:'Bodega Principal',
              estado: est,
              cantidad_total: est==='ok'?Math.round(50+Math.random()*200) : est==='bajo'?5 : 0,
              num_productos: est==='vacio'?0:1,
              items: est==='vacio'?[]:[{sku:`SKU-${id.toString().padStart(3,'0')}`,nombre:`Producto ${id}`,lote:`L-${id}`,cantidad:est==='ok'?Math.round(50+Math.random()*200):5}],
            })
            id++
          }
        }
      }
    }
    return mock
  }, [ubicaciones])

  const displayData = MOCK
    ? { ubicaciones: MOCK, bodegas: [{ id:1, codigo:'BPR', nombre:'Bodega Principal' }] }
    : { ubicaciones: filtered, bodegas }

  const displayGrouped = useMemo(() => {
    const src = MOCK ? displayData.ubicaciones : filtered
    const g = {}
    for (const u of src) {
      if (!g[u.zona]) g[u.zona] = {}
      const p = u.pasillo || '—'
      if (!g[u.zona][p]) g[u.zona][p] = []
      g[u.zona][p].push(u)
    }
    return g
  }, [MOCK, filtered, displayData])

  return (
    <div className="flex flex-col gap-4">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">

        {/* Stats pills */}
        <div className="flex items-center gap-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-xs">
          <span className="text-muted">{stats.total} ubic.</span>
          <span className="text-border mx-1">·</span>
          <button onClick={() => setFilterEstado(f => f==='ok'?'':'ok')}
            className={`flex items-center gap-1 transition-colors ${filterEstado==='ok'?'text-green-400':'text-muted hover:text-green-400'}`}>
            <div className="w-1.5 h-1.5 rounded-full bg-green-400"/>{stats.ok}
          </button>
          <span className="text-border mx-1">·</span>
          <button onClick={() => setFilterEstado(f => f==='bajo'?'':'bajo')}
            className={`flex items-center gap-1 transition-colors ${filterEstado==='bajo'?'text-orange-400':'text-muted hover:text-orange-400'}`}>
            <div className="w-1.5 h-1.5 rounded-full bg-orange-400"/>{stats.bajo}
          </button>
          <span className="text-border mx-1">·</span>
          <button onClick={() => setFilterEstado(f => f==='vacio'?'':'vacio')}
            className={`flex items-center gap-1 transition-colors ${filterEstado==='vacio'?'text-muted':'text-muted/50 hover:text-muted'}`}>
            <div className="w-1.5 h-1.5 rounded-full bg-muted/40"/>{ stats.vacio}
          </button>
        </div>

        {/* Bodega selector */}
        {displayData.bodegas.length > 1 && (
          <select value={filterBodega} onChange={e => { setFilterBodega(e.target.value); setFilterZona('') }}
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50">
            <option value="">Todas las bodegas</option>
            {displayData.bodegas.map(b => (
              <option key={b.id} value={String(b.id)}>{b.nombre}</option>
            ))}
          </select>
        )}

        {/* Zona selector */}
        <select value={filterZona} onChange={e => setFilterZona(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50">
          <option value="">Todas las zonas</option>
          {(MOCK ? ['Zona A','Zona B','Zona C'] : zonas).map(z => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>

        {/* Search */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar código o SKU…"
            className="w-full bg-surface border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder-muted focus:outline-none focus:border-primary/50"/>
        </div>

        {/* Refresh */}
        <button onClick={fetchMapa}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface border border-border text-muted hover:text-foreground transition-colors">
          <RefreshCw size={12} className={loadingMapa ? 'animate-spin' : ''}/>
        </button>
      </div>

      {/* Mock notice */}
      {MOCK && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/4 border border-border text-xs text-muted">
          <Layers size={12} className="shrink-0"/>
          <span>Vista de demo — aún no hay ubicaciones registradas. El mapa mostrará datos reales una vez que se creen ubicaciones en la base de datos.</span>
        </div>
      )}

      {/* ── Layout principal: mapa + detalle ── */}
      <div className="flex gap-4 items-start">

        {/* MAPA */}
        <div className="flex-1 min-w-0 bg-surface border border-border rounded-xl overflow-hidden">
          {loadingMapa ? (
            <div className="flex items-center justify-center py-20 gap-2 text-muted">
              <RefreshCw size={16} className="animate-spin"/>
              <span className="text-sm">Cargando mapa…</span>
            </div>
          ) : Object.keys(displayGrouped).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Box size={32} className="text-muted opacity-30"/>
              <p className="text-sm text-muted">Sin ubicaciones que mostrar</p>
              {search && (
                <button onClick={() => setSearch('')}
                  className="text-xs text-primary hover:underline">Limpiar búsqueda</button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {Object.entries(displayGrouped).sort(([a],[b])=>a.localeCompare(b)).map(([zona, pasillos]) => (
                <div key={zona}>
                  {/* Zona header */}
                  <div className="flex items-center gap-2 px-4 py-2 bg-white/[0.02] border-b border-border/50">
                    <div className="w-1.5 h-4 rounded-full bg-primary opacity-60"/>
                    <span className="text-xs font-bold text-subtle uppercase tracking-widest">{zona}</span>
                    <span className="text-[10px] text-muted ml-auto">
                      {Object.values(pasillos).flat().length} ubic.
                    </span>
                  </div>

                  {/* Pasillos */}
                  <div className="p-4 space-y-4">
                    {Object.entries(pasillos).sort(([a],[b])=>a.localeCompare(b)).map(([pasillo, cells]) => (
                      <div key={pasillo}>
                        {pasillo !== '—' && (
                          <p className="text-[10px] text-muted uppercase tracking-wider mb-2 font-semibold">
                            Pasillo {pasillo}
                          </p>
                        )}
                        {/* Grid de celdas */}
                        <div className="flex flex-wrap gap-2">
                          {cells.map(ub => (
                            <UbicCell
                              key={ub.id}
                              ub={ub}
                              selected={selected?.id === ub.id}
                              onClick={u => setSelected(sel => sel?.id === u.id ? null : u)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* PANEL DETALLE */}
        {selected && (
          <div className="shrink-0" style={{ animation: 'slideInRight .2s ease' }}>
            <DetailPanel ub={selected} onClose={() => setSelected(null)}/>
          </div>
        )}
      </div>

      {/* Leyenda */}
      <div className="flex items-center gap-4 px-1">
        {Object.entries(ESTADO).map(([k,e]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: e.dot }}/>
            <span className="text-[10px] text-muted">{e.label}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slideInRight {
          from { opacity:0; transform:translateX(12px) }
          to   { opacity:1; transform:translateX(0) }
        }
      `}</style>
    </div>
  )
}
