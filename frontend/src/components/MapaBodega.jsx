import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useInventoryStore } from '../store/inventoryStore'
import {
  X, Plus, Edit2, Trash2, ChevronLeft, Save, RefreshCw,
  Layers, Box, Package, AlertTriangle, Move, Grid,
} from 'lucide-react'

// ─── Colores de zona ──────────────────────────────────────────────────────────
const ZONA_COLORS = [
  { bg:'#58a6ff18', border:'#58a6ff50', dot:'#58a6ff', label:'Azul'   },
  { bg:'#3fb95018', border:'#3fb95050', dot:'#3fb950', label:'Verde'  },
  { bg:'#f0883e18', border:'#f0883e50', dot:'#f0883e', label:'Naranja'},
  { bg:'#d2a8ff18', border:'#d2a8ff50', dot:'#d2a8ff', label:'Violeta'},
  { bg:'#f8514918', border:'#f8514950', dot:'#f85149', label:'Rojo'   },
  { bg:'#e3b34118', border:'#e3b34150', dot:'#e3b341', label:'Amarillo'},
]
const zoneColor = (zona) => {
  const idx = (zona||'').charCodeAt(zona?.length-1||0) % ZONA_COLORS.length
  return ZONA_COLORS[Math.abs(idx)] || ZONA_COLORS[0]
}

// ─── Estado de celda ──────────────────────────────────────────────────────────
const ESTADO = {
  ok:    { bg:'#3fb95020', border:'#3fb95060', dot:'#3fb950' },
  bajo:  { bg:'#f0883e20', border:'#f0883e60', dot:'#f0883e' },
  vacio: { bg:'#ffffff08', border:'#30363d',   dot:'#30363d' },
}

// ─── API helpers ──────────────────────────────────────────────────────────────
const API = '/api/v1'
const authHeaders = () => {
  const token = JSON.parse(localStorage.getItem('wms_auth')||'{}')?.token || ''
  return { 'Content-Type':'application/json', Authorization:`Bearer ${token}` }
}
const apiFetch = (path, opts={}) =>
  fetch(`${API}${path}`, { ...opts, headers: { ...authHeaders(), ...(opts.headers||{}) } })
    .then(r => r.json())

// ══════════════════════════════════════════════════════════════════════════════
// VISTA 1 — PLANO DE PLANTA (vista pájaro)
// ══════════════════════════════════════════════════════════════════════════════
function PlanoPajaro({ ubicaciones, bodegas, onZoneClick, onRefresh }) {
  const canvasRef   = useRef(null)
  const dragging    = useRef(null)
  const [zones,     setZones]     = useState({})   // { zoneName: {x,y,w,h} }
  const [draggingZ, setDraggingZ] = useState(null)
  const [newZone,   setNewZone]   = useState('')
  const [editMode,  setEditMode]  = useState(false)
  const [saving,    setSaving]    = useState(false)
  const STORAGE_KEY = 'wms_plano_zonas'

  // Calcular zonas únicas con posiciones
  const zonaNames = useMemo(() => [...new Set(ubicaciones.map(u=>u.zona))].sort(), [ubicaciones])

  // Init posiciones desde localStorage o grid automático
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')
    const z = {}
    zonaNames.forEach((name, i) => {
      const cols = 3
      const col  = i % cols, row = Math.floor(i / cols)
      z[name] = saved[name] || {
        x: 40 + col * 220, y: 40 + row * 160, w: 180, h: 120
      }
    })
    setZones(z)
  }, [zonaNames])

  // Drag zona
  const startDrag = useCallback((e, name) => {
    if (!editMode) return
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    dragging.current = {
      name,
      startMouseX: e.clientX - rect.left,
      startMouseY: e.clientY - rect.top,
      origX: zones[name]?.x || 0,
      origY: zones[name]?.y || 0,
    }
  }, [editMode, zones])

  const onMouseMove = useCallback((e) => {
    if (!dragging.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const dx = mx - dragging.current.startMouseX
    const dy = my - dragging.current.startMouseY
    setZones(prev => ({
      ...prev,
      [dragging.current.name]: {
        ...prev[dragging.current.name],
        x: Math.max(0, dragging.current.origX + dx),
        y: Math.max(0, dragging.current.origY + dy),
      }
    }))
  }, [])

  const onMouseUp = useCallback(() => {
    if (dragging.current) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(zones))
    }
    dragging.current = null
  }, [zones])

  const addZone = () => {
    const name = newZone.trim()
    if (!name || zones[name]) return
    setZones(prev => {
      const count = Object.keys(prev).length
      const cols = 3, col = count % cols, row = Math.floor(count / cols)
      const next = { ...prev, [name]: { x: 40+col*220, y: 40+row*160, w: 180, h: 120 } }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
    setNewZone('')
  }

  const saveLayout = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(zones))
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setEditMode(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
            editMode ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-surface border-border text-muted hover:text-foreground'
          }`}>
          <Move size={12}/>{editMode ? 'Modo edición activo' : 'Organizar zonas'}
        </button>

        {editMode && (
          <>
            <div className="flex items-center gap-1">
              <input value={newZone} onChange={e=>setNewZone(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&addZone()}
                placeholder="Nueva zona…"
                className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50 w-36"/>
              <button onClick={addZone} disabled={!newZone.trim()}
                className="px-3 py-1.5 rounded-lg bg-primary text-black text-xs font-bold disabled:opacity-40 flex items-center gap-1">
                <Plus size={12}/>Añadir
              </button>
            </div>
            <button onClick={saveLayout}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/25 transition-colors">
              <Save size={12}/>Guardar
            </button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-muted">Toca una zona para ver sus estantes</span>
          <button onClick={onRefresh}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface border border-border text-muted hover:text-foreground">
            <RefreshCw size={12}/>
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={canvasRef}
        className="relative bg-surface border border-border rounded-xl overflow-hidden select-none"
        style={{
          height: '420px',
          backgroundImage: 'radial-gradient(circle,#30363d 1px,transparent 1px)',
          backgroundSize: '24px 24px',
          cursor: editMode ? 'default' : 'default',
        }}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}>

        {/* Leyenda modo edición */}
        {editMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-primary/10 border border-primary/30 text-primary text-[10px] font-semibold px-3 py-1.5 rounded-full pointer-events-none">
            Arrastra las zonas para organizarlas
          </div>
        )}

        {/* Zonas */}
        {Object.entries(zones).map(([name, pos]) => {
          const col   = zoneColor(name)
          const cells = ubicaciones.filter(u => u.zona === name)
          const ok    = cells.filter(u=>u.estado==='ok').length
          const bajo  = cells.filter(u=>u.estado==='bajo').length
          const vacio = cells.filter(u=>u.estado==='vacio').length

          return (
            <div key={name}
              className="absolute rounded-xl border-2 flex flex-col overflow-hidden transition-shadow"
              style={{
                left: pos.x, top: pos.y, width: pos.w, height: pos.h,
                background: col.bg, borderColor: col.border,
                boxShadow: editMode ? `0 0 0 2px ${col.dot}30` : 'none',
                cursor: editMode ? 'grab' : 'pointer',
                zIndex: draggingZ === name ? 10 : 1,
              }}
              onMouseDown={e => startDrag(e, name)}
              onClick={() => !editMode && onZoneClick(name)}>

              {/* Header zona */}
              <div className="flex items-center gap-2 px-3 py-2 border-b"
                style={{ borderColor: col.border }}>
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: col.dot }}/>
                <span className="text-xs font-bold text-foreground truncate flex-1">{name}</span>
                {editMode && <Move size={10} className="text-muted shrink-0"/>}
              </div>

              {/* Stats */}
              <div className="flex-1 flex items-center justify-center gap-3 px-3">
                {cells.length === 0 ? (
                  <span className="text-[10px] text-muted">Sin ubicaciones</span>
                ) : (
                  <>
                    <div className="text-center">
                      <p className="text-base font-black text-foreground">{cells.length}</p>
                      <p className="text-[9px] text-muted">total</p>
                    </div>
                    <div className="h-8 w-px bg-border/50"/>
                    <div className="flex flex-col gap-0.5">
                      {ok>0    && <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-400"/><span className="text-[9px] text-muted">{ok} ok</span></div>}
                      {bajo>0  && <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-orange-400"/><span className="text-[9px] text-muted">{bajo} bajo</span></div>}
                      {vacio>0 && <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-border"/><span className="text-[9px] text-muted">{vacio} vacía</span></div>}
                    </div>
                  </>
                )}
              </div>

              {/* Footer — hint */}
              {!editMode && (
                <div className="px-3 py-1.5 text-center">
                  <span className="text-[9px]" style={{ color: col.dot }}>→ Ver estantes</span>
                </div>
              )}
            </div>
          )
        })}

        {/* Canvas vacío */}
        {Object.keys(zones).length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Layers size={32} className="text-muted opacity-30"/>
            <p className="text-sm text-muted">Activa "Organizar zonas" y añade zonas al plano</p>
          </div>
        )}
      </div>

      {/* Leyenda */}
      <div className="flex items-center gap-4 px-1">
        {[['#3fb950','Con stock'],['#f0883e','Bajo mínimo'],['#30363d','Vacía']].map(([c,l])=>(
          <div key={l} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{background:c}}/>
            <span className="text-[10px] text-muted">{l}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA 2 — ESTANTES (vista frontal de rack)
// ══════════════════════════════════════════════════════════════════════════════
function VistaEstantes({ zona, ubicaciones, onBack, onRefresh }) {
  const col          = zoneColor(zona)
  const [selected,   setSelected]   = useState(null)
  const [editModal,  setEditModal]  = useState(null)
  const [dragOver,   setDragOver]   = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [toast,      setToast]      = useState(null)

  const showToast = (msg, ok) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  // Agrupar por pasillo → nivel
  const pasillos = useMemo(() => {
    const p = {}
    for (const u of ubicaciones) {
      const pas = u.pasillo || '01'
      if (!p[pas]) p[pas] = {}
      const niv = u.nivel || '1'
      if (!p[pas][niv]) p[pas][niv] = []
      p[pas][niv].push(u)
    }
    return p
  }, [ubicaciones])

  const pasilloNames = Object.keys(pasillos).sort()
  const [activePasillo, setActivePasillo] = useState(pasilloNames[0] || '01')

  useEffect(() => {
    if (pasilloNames.length && !pasillos[activePasillo]) {
      setActivePasillo(pasilloNames[0])
    }
  }, [pasilloNames, activePasillo])

  // Crear ubicación
  const createUbicacion = async (codigo, pasillo, nivel, posicion) => {
    setSaving(true)
    const res = await apiFetch('/inventory/ubicaciones', {
      method: 'POST',
      body: JSON.stringify({ codigo, zona, pasillo, nivel, posicion })
    })
    setSaving(false)
    if (res.ok) { onRefresh(); showToast('Ubicación creada', true) }
    else showToast(res.error || 'Error al crear', false)
  }

  // Editar ubicación
  const saveEdit = async () => {
    if (!editModal) return
    setSaving(true)
    const res = await apiFetch('/inventory/ubicaciones', {
      method: 'PUT',
      body: JSON.stringify({ id: editModal.id, codigo: editModal.codigo, zona: editModal.zona, pasillo: editModal.pasillo, nivel: editModal.nivel })
    })
    setSaving(false)
    setEditModal(null)
    if (res.ok) { onRefresh(); showToast('Guardado', true) }
    else showToast(res.error || 'Error', false)
  }

  // Eliminar ubicación
  const deleteUbicacion = async (id) => {
    if (!confirm('¿Eliminar esta ubicación? Solo es posible si está vacía.')) return
    const res = await apiFetch(`/inventory/ubicaciones?id=${id}`, { method: 'DELETE' })
    if (res.ok) { setSelected(null); onRefresh(); showToast('Eliminada', true) }
    else showToast(res.error || 'No se puede eliminar', false)
  }

  // Niveles del pasillo activo (de arriba a abajo = nivel alto a bajo)
  const niveles = pasillos[activePasillo]
    ? Object.keys(pasillos[activePasillo]).sort((a,b) => Number(b)-Number(a))
    : []

  return (
    <div className="flex flex-col gap-3">

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border text-sm font-medium shadow-xl transition-all ${
          toast.ok ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-red-500/15 border-red-500/30 text-red-400'
        }`}>{toast.msg}</div>
      )}

      {/* Modal editar */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{background:'rgba(0,0,0,0.7)',backdropFilter:'blur(6px)'}}
          onClick={()=>setEditModal(null)}>
          <div className="bg-surface border border-border rounded-2xl p-5 w-full max-w-sm shadow-2xl"
            onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-foreground">Editar ubicación</p>
              <button onClick={()=>setEditModal(null)} className="text-muted hover:text-foreground"><X size={14}/></button>
            </div>
            {[['Código','codigo'],['Zona','zona'],['Pasillo','pasillo'],['Nivel','nivel']].map(([label,field])=>(
              <div key={field} className="mb-3">
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">{label}</label>
                <input value={editModal[field]||''} onChange={e=>setEditModal(p=>({...p,[field]:e.target.value}))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"/>
              </div>
            ))}
            <div className="flex gap-2 mt-4">
              <button onClick={()=>setEditModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-border text-muted text-sm">Cancelar</button>
              <button onClick={saveEdit} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-primary text-black text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1">
                {saving ? <RefreshCw size={12} className="animate-spin"/> : <Save size={12}/>}Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border text-muted hover:text-foreground text-xs font-semibold transition-colors">
          <ChevronLeft size={13}/>Plano
        </button>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{background:col.dot}}/>
          <span className="text-sm font-bold text-foreground">{zona}</span>
        </div>
        <span className="text-muted text-xs">— {ubicaciones.length} ubicaciones</span>
        <button onClick={onRefresh} className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg bg-surface border border-border text-muted hover:text-foreground">
          <RefreshCw size={11}/>
        </button>
      </div>

      <div className="flex gap-4 items-start">

        {/* Panel izquierdo — pasillos + estante */}
        <div className="flex-1 min-w-0">

          {/* Selector pasillo */}
          {pasilloNames.length > 1 && (
            <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
              {pasilloNames.map(p => (
                <button key={p} onClick={()=>setActivePasillo(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-all border ${
                    activePasillo===p
                      ? 'text-foreground border-border/80 bg-white/8'
                      : 'text-muted border-transparent hover:border-border'
                  }`}>
                  Pasillo {p}
                </button>
              ))}
              {/* Botón agregar pasillo */}
              <button onClick={()=>{
                const next = String(pasilloNames.length+1).padStart(2,'0')
                createUbicacion(`${zona.replace('Zona ','Z')}-${next}-1a`, next, '1', 'a')
              }}
                className="px-3 py-1.5 rounded-lg border border-dashed border-border text-muted hover:text-primary hover:border-primary/40 text-xs shrink-0 flex items-center gap-1 transition-colors">
                <Plus size={11}/>Pasillo
              </button>
            </div>
          )}

          {/* Rack visual */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            {/* Etiqueta pasillo */}
            <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between">
              <span className="text-xs font-bold text-muted uppercase tracking-widest">
                Pasillo {activePasillo}
              </span>
              <button onClick={()=>{
                const niv = String(niveles.length > 0 ? Math.max(...niveles.map(Number))+1 : 1)
                createUbicacion(`${zona.replace('Zona ','Z')}-${activePasillo}-${niv}a`, activePasillo, niv, 'a')
              }}
                className="flex items-center gap-1 text-[10px] text-muted hover:text-primary transition-colors">
                <Plus size={10}/>Nivel
              </button>
            </div>

            {niveles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Grid size={24} className="text-muted opacity-30"/>
                <p className="text-xs text-muted">Sin niveles — añade uno</p>
              </div>
            ) : (
              <div className="p-4 space-y-2">
                {niveles.map(niv => {
                  const cells = (pasillos[activePasillo]?.[niv] || []).sort((a,b)=>a.posicion?.localeCompare(b.posicion||'')||0)
                  return (
                    <div key={niv} className="flex items-center gap-2">
                      {/* Etiqueta nivel */}
                      <div className="w-10 shrink-0 text-center">
                        <span className="text-[10px] text-muted font-mono font-bold">N{niv}</span>
                      </div>

                      {/* Celdas */}
                      <div className="flex gap-1.5 flex-wrap flex-1">
                        {cells.map(u => {
                          const e = ESTADO[u.estado] || ESTADO.vacio
                          return (
                            <button key={u.id}
                              onClick={() => setSelected(sel=>sel?.id===u.id?null:u)}
                              className="relative rounded-lg border-2 flex flex-col items-center justify-center transition-all duration-150 active:scale-95"
                              style={{
                                width:'56px', height:'56px',
                                background: selected?.id===u.id ? e.dot+'30' : e.bg,
                                borderColor: selected?.id===u.id ? e.dot : e.border,
                                boxShadow: selected?.id===u.id ? `0 0 0 2px ${e.dot}50` : 'none',
                              }}>
                              <div className="w-2 h-2 rounded-full mb-0.5" style={{background:e.dot}}/>
                              <span className="text-[9px] font-mono font-bold text-foreground/80">
                                {u.posicion||u.codigo.slice(-2)}
                              </span>
                              {u.estado!=='vacio' && (
                                <span className="text-[8px] tabular-nums" style={{color:e.dot}}>
                                  {u.cantidad_total>=1000?(u.cantidad_total/1000).toFixed(1)+'k':Math.round(u.cantidad_total)}
                                </span>
                              )}
                            </button>
                          )
                        })}

                        {/* Drop zone — añadir posición */}
                        <button
                          onClick={() => {
                            const nextPos = String.fromCharCode(97 + cells.length)
                            createUbicacion(
                              `${zona.replace('Zona ','Z')}-${activePasillo}-${niv}${nextPos}`,
                              activePasillo, niv, nextPos
                            )
                          }}
                          className="w-14 h-14 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-muted hover:border-primary/50 hover:text-primary transition-colors">
                          <Plus size={14}/>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Panel derecho — detalle */}
        {selected && (
          <div className="shrink-0 w-64 bg-surface border border-border rounded-xl overflow-hidden"
            style={{animation:'slideIn .15s ease'}}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{background: (ESTADO[selected.estado]||ESTADO.vacio).dot}}/>
                <span className="text-sm font-bold font-mono text-foreground">{selected.codigo}</span>
              </div>
              <button onClick={()=>setSelected(null)} className="text-muted hover:text-foreground"><X size={13}/></button>
            </div>

            {/* Meta info */}
            <div className="px-4 py-3 space-y-1.5 border-b border-border/50">
              {[['Zona',selected.zona],['Pasillo',selected.pasillo],['Nivel',selected.nivel],['Posición',selected.posicion]].map(([k,v])=>(
                <div key={k} className="flex justify-between">
                  <span className="text-[10px] text-muted uppercase tracking-wide">{k}</span>
                  <span className="text-xs font-medium text-subtle">{v||'—'}</span>
                </div>
              ))}
            </div>

            {/* Items de stock */}
            <div className="max-h-48 overflow-y-auto">
              {selected.items.length === 0 ? (
                <div className="flex flex-col items-center py-6 gap-1">
                  <Box size={18} className="text-muted opacity-30"/>
                  <span className="text-xs text-muted">Vacía</span>
                </div>
              ) : selected.items.map((item,i) => (
                <div key={i} className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/20 last:border-0 hover:bg-white/3">
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-primary truncate">{item.sku}</p>
                    <p className="text-[10px] text-muted truncate">{item.nombre}</p>
                    {item.lote!=='—'&&<p className="text-[9px] text-muted/60">Lote: {item.lote}</p>}
                  </div>
                  <span className="text-sm font-bold tabular-nums text-foreground shrink-0">
                    {Number(item.cantidad).toLocaleString('es-CO',{maximumFractionDigits:1})}
                  </span>
                </div>
              ))}
            </div>

            {/* Acciones */}
            <div className="px-4 py-3 border-t border-border flex gap-2">
              <button onClick={()=>setEditModal({...selected})}
                className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-muted hover:text-foreground text-xs transition-colors">
                <Edit2 size={11}/>Editar
              </button>
              <button onClick={()=>deleteUbicacion(selected.id)}
                className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs transition-colors">
                <Trash2 size={11}/>
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:translateX(0)}}`}</style>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL — orquesta las dos vistas
// ══════════════════════════════════════════════════════════════════════════════
export default function MapaBodega() {
  const { mapa, loadingMapa, fetchMapa } = useInventoryStore()
  const [view,       setView]      = useState('plano')   // 'plano' | 'estantes'
  const [activeZona, setActiveZona] = useState(null)

  useEffect(() => { fetchMapa() }, [])

  const ubicaciones = mapa?.ubicaciones ?? []
  const bodegas     = mapa?.bodegas     ?? []

  const handleZoneClick = (zona) => {
    setActiveZona(zona)
    setView('estantes')
  }

  const zonaUbicaciones = ubicaciones.filter(u => u.zona === activeZona)

  return (
    <div>
      {view === 'plano' ? (
        <PlanoPajaro
          ubicaciones={ubicaciones}
          bodegas={bodegas}
          onZoneClick={handleZoneClick}
          onRefresh={fetchMapa}
        />
      ) : (
        <VistaEstantes
          zona={activeZona}
          ubicaciones={zonaUbicaciones}
          onBack={() => setView('plano')}
          onRefresh={fetchMapa}
        />
      )}
    </div>
  )
}
