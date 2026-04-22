import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useInventoryStore } from '../store/inventoryStore'
import { createUbicacion, updateUbicacion, deleteUbicacion } from '../api/inventory.api'
import { X, RefreshCw, Edit2, Trash2, Check, Plus, Move, Eye, Settings } from 'lucide-react'

// ─── Constantes ───────────────────────────────────────────────────────────────
const CELL_W = 64
const CELL_H = 64
const GRID   = 24   // snap grid px

const ZONA_COLORS = {
  'Zona A': { bg:'#58a6ff18', border:'#58a6ff50', accent:'#58a6ff', label:'#58a6ff' },
  'Zona B': { bg:'#3fb95018', border:'#3fb95050', accent:'#3fb950', label:'#3fb950' },
  'Zona C': { bg:'#f0883e18', border:'#f0883e50', accent:'#f0883e', label:'#f0883e' },
  'Zona D': { bg:'#d2a8ff18', border:'#d2a8ff50', accent:'#d2a8ff', label:'#d2a8ff' },
  'Zona E': { bg:'#f8514918', border:'#f8514950', accent:'#f85149', label:'#f85149' },
}
const STOCK_STATE = {
  ok:    '#3fb950',
  bajo:  '#f0883e',
  vacio: '#8b949e',
}
const snap = v => Math.round(v / GRID) * GRID

// ─── Plantillas del panel lateral ────────────────────────────────────────────
const TEMPLATES = [
  { id:'single',  label:'Ubicación',   w:1, h:1, icon:'□' },
  { id:'row3',    label:'Fila 3',      w:3, h:1, icon:'□□□' },
  { id:'row5',    label:'Fila 5',      w:5, h:1, icon:'□□□□□' },
  { id:'rack2x4', label:'Rack 2×4',   w:2, h:4, icon:'▦' },
  { id:'rack3x3', label:'Rack 3×3',   w:3, h:3, icon:'▦' },
]

// ─── Genera ubicaciones desde una plantilla ───────────────────────────────────
function generateFromTemplate(tpl, zona, pasillo, startX, startY) {
  const items = []
  for (let row = 0; row < tpl.h; row++) {
    for (let col = 0; col < tpl.w; col++) {
      const nivel   = String(row + 1)
      const posicion= String.fromCharCode(97 + col)
      items.push({
        codigo:   `${zona.replace('Zona ','')}-${String(pasillo).padStart(2,'0')}-${nivel}${posicion}`,
        zona,
        pasillo:  String(pasillo).padStart(2,'0'),
        nivel,
        posicion,
        canvas_x: startX + col * (CELL_W + 4),
        canvas_y: startY + row * (CELL_H + 4),
      })
    }
  }
  return items
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, ok, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [])
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-2xl text-sm font-medium"
      style={{
        background: ok ? '#3fb95020' : '#f8514920',
        borderColor: ok ? '#3fb95060' : '#f8514960',
        color: ok ? '#3fb950' : '#f85149',
        animation: 'slideInRight .2s ease',
      }}>
      {ok ? <Check size={14}/> : <X size={14}/>}
      {msg}
    </div>
  )
}

// ─── Modal editar ubicación ───────────────────────────────────────────────────
function EditModal({ ub, onSave, onDelete, onClose }) {
  const [codigo, setCodigo] = useState(ub.codigo)
  const [zona,   setZona]   = useState(ub.zona)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateUbicacion({ id: ub.id, codigo, zona })
      onSave({ ...ub, codigo, zona })
    } catch(e) {
      console.error(e)
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar ubicación ${ub.codigo}?`)) return
    try {
      await deleteUbicacion(ub.id)
      onDelete(ub.id)
    } catch(e) {
      alert(e.response?.data?.error || 'Error al eliminar')
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)' }}
      onClick={onClose}>
      <div className="bg-[#161b22] border border-border rounded-2xl w-full max-w-sm shadow-2xl p-5"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold text-foreground">Editar ubicación</p>
          <button onClick={onClose} className="text-muted hover:text-foreground"><X size={14}/></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Código</label>
            <input value={codigo} onChange={e => setCodigo(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 font-mono"/>
          </div>
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Zona</label>
            <select value={zona} onChange={e => setZona(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50">
              {Object.keys(ZONA_COLORS).map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          {ub.estado !== 'vacio' && (
            <div className="rounded-lg bg-white/4 border border-border px-3 py-2">
              <p className="text-[10px] text-muted mb-1">Stock actual</p>
              <p className="text-sm font-bold tabular-nums"
                style={{ color: STOCK_STATE[ub.estado] }}>
                {ub.cantidad_total?.toLocaleString('es-CO')} u. · {ub.num_productos} prod.
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={handleDelete}
            className="p-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 size={14}/>
          </button>
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-border text-muted text-sm hover:bg-white/5 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2 rounded-lg bg-primary text-black text-sm font-bold hover:bg-primary/80 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
            {saving ? <RefreshCw size={12} className="animate-spin"/> : <Check size={12}/>}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Panel lateral de plantillas ─────────────────────────────────────────────
function SidePanel({ zonaActiva, setZonaActiva, pasilloActivo, setPasilloActivo, onDragStart }) {
  return (
    <div className="flex flex-col gap-4 w-52 shrink-0">

      {/* Configuración */}
      <div className="bg-surface border border-border rounded-xl p-3 space-y-3">
        <p className="text-[10px] text-muted uppercase tracking-wider font-semibold">Configurar</p>
        <div>
          <label className="text-[10px] text-muted block mb-1">Zona</label>
          <select value={zonaActiva} onChange={e => setZonaActiva(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none">
            {Object.keys(ZONA_COLORS).map(z => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted block mb-1">Pasillo</label>
          <input type="number" min="1" max="99" value={pasilloActivo}
            onChange={e => setPasilloActivo(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none font-mono"/>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ background: ZONA_COLORS[zonaActiva]?.accent }}/>
          <span className="text-[10px] text-muted">{zonaActiva} · Pasillo {String(pasilloActivo).padStart(2,'0')}</span>
        </div>
      </div>

      {/* Plantillas */}
      <div className="bg-surface border border-border rounded-xl p-3">
        <p className="text-[10px] text-muted uppercase tracking-wider font-semibold mb-2.5">Plantillas</p>
        <p className="text-[10px] text-muted/60 mb-3 leading-relaxed">
          Arrastra al plano para crear ubicaciones
        </p>
        <div className="space-y-1.5">
          {TEMPLATES.map(tpl => (
            <div key={tpl.id}
              draggable
              onDragStart={e => onDragStart(e, tpl)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-background hover:border-primary/40 hover:bg-primary/5 cursor-grab active:cursor-grabbing transition-all active:scale-95 select-none">
              <span className="text-base leading-none font-mono text-muted">{tpl.icon}</span>
              <div>
                <p className="text-xs font-medium text-foreground">{tpl.label}</p>
                <p className="text-[9px] text-muted">{tpl.w}×{tpl.h} celda{tpl.w*tpl.h>1?'s':''}</p>
              </div>
              <Move size={11} className="text-muted/40 ml-auto"/>
            </div>
          ))}
        </div>
      </div>

      {/* Leyenda */}
      <div className="bg-surface border border-border rounded-xl p-3">
        <p className="text-[10px] text-muted uppercase tracking-wider font-semibold mb-2">Estado</p>
        <div className="space-y-1.5">
          {[['ok','#3fb950','Con stock'],['bajo','#f0883e','Bajo mín.'],['vacio','#8b949e','Vacía']].map(([k,c,l]) => (
            <div key={k} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background:c }}/>
              <span className="text-[10px] text-muted">{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Celda de ubicación en el canvas ─────────────────────────────────────────
function CanvasCell({ ub, selected, editMode, onSelect, onDragStart, onDragEnd }) {
  const color  = STOCK_STATE[ub.estado] || STOCK_STATE.vacio
  const zc     = ZONA_COLORS[ub.zona]   || ZONA_COLORS['Zona A']
  const isDrag = useRef(false)

  return (
    <div
      draggable={editMode}
      onDragStart={e => { isDrag.current = true; onDragStart(e, ub) }}
      onDragEnd={e => { isDrag.current = false; onDragEnd(e) }}
      onClick={() => { if (!isDrag.current) onSelect(ub) }}
      className="absolute flex flex-col items-center justify-center rounded-xl border-2 transition-all duration-150 select-none"
      style={{
        left:        ub.canvas_x,
        top:         ub.canvas_y,
        width:       CELL_W,
        height:      CELL_H,
        background:  selected ? `${color}30` : zc.bg,
        borderColor: selected ? color         : (ub.estado==='vacio' ? '#30363d' : color+'80'),
        boxShadow:   selected ? `0 0 0 2px ${color}50, 0 4px 16px ${color}20` : `0 2px 8px ${zc.accent}10`,
        cursor:      editMode ? 'grab' : 'pointer',
        zIndex:      selected ? 10 : 1,
      }}>
      {/* Dot estado */}
      <div className="w-2 h-2 rounded-full mb-1" style={{ background: color }}/>
      {/* Código */}
      <span className="text-[9px] font-mono font-bold leading-none text-center px-1 truncate w-full text-center"
        style={{ color: ub.estado==='vacio' ? '#8b949e' : '#e6edf3' }}>
        {ub.codigo.split('-').slice(-2).join('-') || ub.codigo}
      </span>
      {/* Cantidad */}
      {ub.estado !== 'vacio' && (
        <span className="text-[8px] tabular-nums mt-0.5 font-bold" style={{ color }}>
          {ub.cantidad_total >= 1000
            ? (ub.cantidad_total/1000).toFixed(1)+'k'
            : Math.round(ub.cantidad_total)}
        </span>
      )}
      {/* Edit icon overlay */}
      {editMode && (
        <div className="absolute inset-0 rounded-xl flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors opacity-0 hover:opacity-100">
          <Move size={14} className="text-white"/>
        </div>
      )}
    </div>
  )
}

// ─── Etiquetas de zona en el canvas ──────────────────────────────────────────
function ZoneLabels({ ubicaciones }) {
  const zones = useMemo(() => {
    const map = {}
    for (const u of ubicaciones) {
      if (!map[u.zona]) map[u.zona] = { minX:Infinity, minY:Infinity, maxX:0, maxY:0 }
      const z = map[u.zona]
      z.minX = Math.min(z.minX, u.canvas_x)
      z.minY = Math.min(z.minY, u.canvas_y - 28)
      z.maxX = Math.max(z.maxX, u.canvas_x + CELL_W)
      z.maxY = Math.max(z.maxY, u.canvas_y + CELL_H)
    }
    return map
  }, [ubicaciones])

  return (
    <>
      {Object.entries(zones).map(([zona, r]) => {
        const zc = ZONA_COLORS[zona] || ZONA_COLORS['Zona A']
        return (
          <div key={zona}>
            {/* Area highlight */}
            <div className="absolute rounded-2xl pointer-events-none"
              style={{
                left:   r.minX - 12,
                top:    r.minY - 8,
                width:  r.maxX - r.minX + 24,
                height: r.maxY - r.minY + 20,
                background: zc.bg,
                border: `1px dashed ${zc.border}`,
              }}/>
            {/* Label */}
            <div className="absolute pointer-events-none px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest"
              style={{
                left:       r.minX - 12,
                top:        r.minY - 26,
                color:      zc.label,
                background: zc.bg,
                border:     `1px solid ${zc.border}`,
              }}>
              {zona}
            </div>
          </div>
        )
      })}
    </>
  )
}

// ─── MAPA PRINCIPAL ───────────────────────────────────────────────────────────
export default function MapaBodega() {
  const { mapa, loadingMapa, fetchMapa } = useInventoryStore()
  const [cells,        setCells]        = useState([])
  const [selected,     setSelected]     = useState(null)
  const [editMode,     setEditMode]     = useState(false)
  const [editModal,    setEditModal]    = useState(null)
  const [zonaActiva,   setZonaActiva]   = useState('Zona A')
  const [pasilloActivo,setPasilloActivo]= useState(1)
  const [dragTpl,      setDragTpl]      = useState(null)
  const [draggingCell, setDraggingCell] = useState(null)
  const [dragOffset,   setDragOffset]  = useState({ x:0, y:0 })
  const [saving,       setSaving]      = useState(false)
  const [toast,        setToast]       = useState(null)
  const canvasRef = useRef(null)

  useEffect(() => { fetchMapa() }, [])

  // Sync cells from store + add mock if empty
  useEffect(() => {
    const src = mapa?.ubicaciones ?? []
    if (src.length === 0) {
      // Auto-layout demo positions if no canvas_x/y
      setCells(buildMockCells())
    } else {
      setCells(src.map((u, i) => ({
        ...u,
        canvas_x: u.canvas_x || (i % 8) * (CELL_W + 8) + 40,
        canvas_y: u.canvas_y || Math.floor(i / 8) * (CELL_H + 8) + 60,
      })))
    }
  }, [mapa])

  const showToast = (msg, ok=true) => { setToast({ msg, ok }); }

  // ── Mock auto-layout ───────────────────────────────────────────────────────
  function buildMockCells() {
    const zonas = [
      { zona:'Zona A', x:40,  y:60,  color:'#58a6ff' },
      { zona:'Zona B', x:40,  y:260, color:'#3fb950' },
      { zona:'Zona C', x:480, y:60,  color:'#f0883e' },
    ]
    const mock = []
    let id = 1
    const estados = ['ok','ok','ok','bajo','vacio','ok','vacio','bajo']
    for (const z of zonas) {
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
          const est = estados[(id-1) % estados.length]
          mock.push({
            id: id++,
            codigo: `${z.zona.replace('Zona ','')}${String(row+1).padStart(2,'0')}${String.fromCharCode(96+col+1)}`,
            zona: z.zona, pasillo: String(row+1).padStart(2,'0'),
            nivel: '1', posicion: String.fromCharCode(96+col+1),
            canvas_x: z.x + col*(CELL_W+6),
            canvas_y: z.y + row*(CELL_H+6),
            estado: est,
            cantidad_total: est==='ok'?Math.round(50+Math.random()*200):est==='bajo'?5:0,
            num_productos: est==='vacio'?0:1,
            items: [],
            _mock: true,
          })
        }
      }
    }
    return mock
  }

  const isMock = cells.length > 0 && cells[0]?._mock

  // ── Canvas coords ──────────────────────────────────────────────────────────
  const getCanvasPos = useCallback((clientX, clientY) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x:0, y:0 }
    return {
      x: snap(clientX - rect.left),
      y: snap(clientY - rect.top),
    }
  }, [])

  // ── Drop plantilla → crear ubicaciones ────────────────────────────────────
  const handleCanvasDrop = async (e) => {
    e.preventDefault()
    if (!dragTpl) return
    const { x, y } = getCanvasPos(e.clientX, e.clientY)
    const items = generateFromTemplate(dragTpl, zonaActiva, pasilloActivo, x, y)

    if (isMock) {
      // Solo visual en mock
      const newCells = items.map((it, i) => ({
        ...it, id: Date.now()+i, estado:'vacio',
        cantidad_total:0, num_productos:0, items:[], _mock:true,
      }))
      setCells(prev => [...prev, ...newCells])
      showToast(`${items.length} ubicación(es) agregada(s) (demo)`)
      setDragTpl(null)
      return
    }

    setSaving(true)
    try {
      const created = []
      for (const it of items) {
        const res = await createUbicacion({ ...it, bodega_id: 1 })
        if (res.ok) created.push({ ...it, id: res.id, estado:'vacio', cantidad_total:0, num_productos:0, items:[] })
      }
      setCells(prev => [...prev, ...created])
      showToast(`${created.length} ubicación(es) creada(s)`)
    } catch(e) {
      showToast(e.response?.data?.error || 'Error al crear', false)
    } finally { setSaving(false); setDragTpl(null) }
  }

  // ── Drag celda existente ───────────────────────────────────────────────────
  const handleCellDragStart = (e, ub) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    setDraggingCell(ub)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleCellDragEnd = async (e) => {
    if (!draggingCell) return
    const { x, y } = getCanvasPos(e.clientX - dragOffset.x + CELL_W/2, e.clientY - dragOffset.y + CELL_H/2)
    const nx = snap(x - CELL_W/2)
    const ny = snap(y - CELL_H/2)

    setCells(prev => prev.map(c => c.id === draggingCell.id ? { ...c, canvas_x:nx, canvas_y:ny } : c))
    setDraggingCell(null)

    if (!isMock) {
      try {
        await updateUbicacion({ id: draggingCell.id, canvas_x: nx, canvas_y: ny })
      } catch(err) { console.error(err) }
    }
  }

  // ── Edit save/delete ───────────────────────────────────────────────────────
  const handleEditSave = (updated) => {
    setCells(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
    setEditModal(null)
    showToast('Ubicación actualizada')
  }

  const handleDelete = (id) => {
    setCells(prev => prev.filter(c => c.id !== id))
    setEditModal(null)
    setSelected(null)
    showToast('Ubicación eliminada')
  }

  // ── Canvas size ────────────────────────────────────────────────────────────
  const canvasSize = useMemo(() => {
    if (!cells.length) return { w: 800, h: 500 }
    const maxX = Math.max(...cells.map(c => (c.canvas_x||0) + CELL_W)) + 80
    const maxY = Math.max(...cells.map(c => (c.canvas_y||0) + CELL_H)) + 80
    return { w: Math.max(maxX, 800), h: Math.max(maxY, 500) }
  }, [cells])

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: cells.length,
    ok:    cells.filter(c => c.estado==='ok').length,
    bajo:  cells.filter(c => c.estado==='bajo').length,
    vacio: cells.filter(c => c.estado==='vacio').length,
  }), [cells])

  const selectedCell = cells.find(c => c.id === selected)

  return (
    <div className="flex gap-4 items-start">

      {/* ── PANEL LATERAL ── */}
      {editMode && (
        <SidePanel
          zonaActiva={zonaActiva}      setZonaActiva={setZonaActiva}
          pasilloActivo={pasilloActivo} setPasilloActivo={setPasilloActivo}
          onDragStart={(e, tpl) => { setDragTpl(tpl); e.dataTransfer.effectAllowed='copy' }}
        />
      )}

      {/* ── CANVAS ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-surface border border-border rounded-lg px-3 py-1.5 text-xs">
            <span className="text-muted">{stats.total} ubic.</span>
            <span className="text-border mx-1">·</span>
            <span className="text-green-400">{stats.ok} ok</span>
            <span className="text-border mx-1">·</span>
            <span className="text-orange-400">{stats.bajo} bajo</span>
            <span className="text-border mx-1">·</span>
            <span className="text-muted">{stats.vacio} vacías</span>
          </div>

          <div className="flex-1"/>

          {isMock && (
            <span className="text-[10px] text-muted bg-surface border border-border rounded-lg px-2.5 py-1.5">
              Vista demo
            </span>
          )}

          {/* Modo ver / editar */}
          <div className="flex items-center rounded-lg border border-border bg-surface overflow-hidden">
            <button onClick={() => setEditMode(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${!editMode?'bg-primary/10 text-primary':'text-muted hover:text-foreground'}`}>
              <Eye size={12}/> Ver
            </button>
            <button onClick={() => setEditMode(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${editMode?'bg-primary/10 text-primary':'text-muted hover:text-foreground'}`}>
              <Settings size={12}/> Editar
            </button>
          </div>

          <button onClick={fetchMapa}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface border border-border text-muted hover:text-foreground transition-colors">
            <RefreshCw size={12} className={loadingMapa?'animate-spin':''}/>
          </button>
        </div>

        {/* Canvas */}
        <div className="bg-surface border border-border rounded-xl overflow-auto"
          style={{ maxHeight:'68vh' }}>
          <div
            ref={canvasRef}
            className="relative"
            style={{
              width:  canvasSize.w,
              height: canvasSize.h,
              backgroundImage: editMode
                ? 'radial-gradient(circle, #30363d 1px, transparent 1px)'
                : 'none',
              backgroundSize: `${GRID}px ${GRID}px`,
              cursor: editMode ? 'crosshair' : 'default',
            }}
            onDragOver={e => e.preventDefault()}
            onDrop={handleCanvasDrop}>

            {/* Zona backgrounds + labels */}
            <ZoneLabels ubicaciones={cells}/>

            {/* Celdas */}
            {cells.map(ub => (
              <CanvasCell
                key={ub.id}
                ub={ub}
                selected={selected === ub.id}
                editMode={editMode}
                onSelect={u => {
                  setSelected(s => s===u.id ? null : u.id)
                  if (editMode && selected===u.id) setEditModal(u)
                }}
                onDragStart={handleCellDragStart}
                onDragEnd={handleCellDragEnd}
              />
            ))}

            {/* Saving overlay */}
            {saving && (
              <div className="absolute inset-0 rounded-xl flex items-center justify-center"
                style={{ background:'rgba(13,17,23,0.5)' }}>
                <div className="flex items-center gap-2 text-sm text-foreground bg-surface border border-border rounded-xl px-4 py-2.5">
                  <RefreshCw size={14} className="animate-spin text-primary"/>
                  Guardando…
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Detail bar */}
        {selectedCell && !editMode && (
          <div className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap"
            style={{ animation:'slideUp .15s ease' }}>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: STOCK_STATE[selectedCell.estado] }}/>
              <span className="text-sm font-bold font-mono text-foreground">{selectedCell.codigo}</span>
            </div>
            <div className="h-4 w-px bg-border"/>
            <span className="text-xs text-muted">{selectedCell.zona} · Pasillo {selectedCell.pasillo}</span>
            {selectedCell.estado !== 'vacio' && <>
              <div className="h-4 w-px bg-border"/>
              <span className="text-sm font-bold tabular-nums" style={{ color: STOCK_STATE[selectedCell.estado] }}>
                {selectedCell.cantidad_total?.toLocaleString('es-CO')} u.
              </span>
              <div className="h-4 w-px bg-border"/>
              <div className="flex flex-wrap gap-2 flex-1">
                {selectedCell.items?.slice(0,3).map((it,i) => (
                  <span key={i} className="text-[10px] bg-white/5 border border-border rounded-lg px-2 py-0.5 font-mono">
                    {it.sku} · {it.cantidad} u.
                  </span>
                ))}
              </div>
            </>}
            {editMode && (
              <button onClick={() => setEditModal(selectedCell)}
                className="ml-auto flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors">
                <Edit2 size={11}/> Editar
              </button>
            )}
            <button onClick={() => setSelected(null)} className="text-muted hover:text-foreground transition-colors">
              <X size={14}/>
            </button>
          </div>
        )}

        {editMode && (
          <p className="text-[10px] text-muted text-center">
            Arrastra plantillas del panel izquierdo al plano · Mueve celdas con drag · Click para seleccionar y editar
          </p>
        )}
      </div>

      {/* ── Modal editar ── */}
      {editModal && (
        <EditModal
          ub={editModal}
          onSave={handleEditSave}
          onDelete={handleDelete}
          onClose={() => setEditModal(null)}
        />
      )}

      {/* ── Toast ── */}
      {toast && <Toast msg={toast.msg} ok={toast.ok} onClose={() => setToast(null)}/>}

      <style>{`
        @keyframes slideUp      { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideInRight { from{opacity:0;transform:translateX(12px)} to{opacity:1;transform:translateX(0)} }
      `}</style>
    </div>
  )
}
