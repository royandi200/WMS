import { useState, useRef, useCallback, useEffect } from 'react'

// ─── Datos demo (se reemplazarán por API) ────────────────────────────────────
const PRODUCTOS_DEMO = [
  { sku: 'PT-VITC-30', nombre: 'Vitamina C 1000mg', qty: 240, lote: 'LOT-2026-01', estado: 'DISPONIBLE' },
  { sku: 'PT-OMEG-60', nombre: 'Omega 3 Fish Oil',  qty: 180, lote: 'LOT-2026-02', estado: 'DISPONIBLE' },
  { sku: 'PT-CALC-90', nombre: 'Calcio + D3',        qty: 95,  lote: 'LOT-2026-03', estado: 'CUARENTENA' },
  { sku: 'PT-MAGN-60', nombre: 'Magnesio 400mg',    qty: 320, lote: 'LOT-2026-04', estado: 'DISPONIBLE' },
  { sku: 'PT-ZINC-30', nombre: 'Zinc 50mg',          qty: 12,  lote: 'LOT-2025-11', estado: 'VENCIDO'    },
  { sku: 'PT-BVIT-30', nombre: 'Complejo B',         qty: 150, lote: 'LOT-2026-05', estado: 'DISPONIBLE' },
]

const TIPO_COLORES = {
  estante:  { bg: 'bg-blue-500/20',   border: 'border-blue-500/50',   label: 'Estante'   },
  piso:     { bg: 'bg-amber-500/20',  border: 'border-amber-500/50',  label: 'Piso'      },
  frio:     { bg: 'bg-cyan-500/20',   border: 'border-cyan-500/50',   label: 'Frío'      },
  cuarentena:{ bg: 'bg-yellow-500/20',border: 'border-yellow-500/50', label: 'Cuarentena'},
  despacho: { bg: 'bg-purple-500/20', border: 'border-purple-500/50', label: 'Despacho'  },
}

const ESTADO_BADGE = {
  DISPONIBLE: 'bg-green-500/20 text-green-400 border-green-500/40',
  CUARENTENA: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  VENCIDO:    'bg-red-500/20 text-red-400 border-red-500/40',
}

const GRID_COLS = 12
const GRID_ROWS = 8
const CELL_PX  = 64  // px por celda en el canvas

const uid = () => Math.random().toString(36).slice(2, 8)

const DEFAULT_LOCATIONS = [
  { id: uid(), col: 1, row: 1, w: 2, h: 1, tipo: 'estante',   label: 'A-01', productos: [PRODUCTOS_DEMO[0], PRODUCTOS_DEMO[1]] },
  { id: uid(), col: 4, row: 1, w: 2, h: 1, tipo: 'estante',   label: 'A-02', productos: [PRODUCTOS_DEMO[3]] },
  { id: uid(), col: 7, row: 1, w: 2, h: 2, tipo: 'frio',      label: 'FRÍO-01', productos: [PRODUCTOS_DEMO[2]] },
  { id: uid(), col: 1, row: 3, w: 3, h: 2, tipo: 'piso',      label: 'PISO-A', productos: [PRODUCTOS_DEMO[5]] },
  { id: uid(), col: 5, row: 3, w: 2, h: 1, tipo: 'cuarentena',label: 'CUA-01', productos: [PRODUCTOS_DEMO[4]] },
  { id: uid(), col: 9, row: 4, w: 3, h: 2, tipo: 'despacho',  label: 'DESP',   productos: [] },
]

export default function MapaBodega() {
  const [locations, setLocations] = useState(DEFAULT_LOCATIONS)
  const [selected, setSelected]   = useState(null)   // id de ubicación seleccionada
  const [mode, setMode]           = useState('view')  // 'view' | 'add' | 'delete'
  const [addTipo, setAddTipo]     = useState('estante')
  const [addLabel, setAddLabel]   = useState('')
  const [dragging, setDragging]   = useState(null)    // { id, offCol, offRow }
  const [dragOver, setDragOver]   = useState(null)    // { col, row }
  const [showModal, setShowModal] = useState(false)
  const [editLoc, setEditLoc]     = useState(null)
  const canvasRef = useRef(null)

  const selectedLoc = locations.find(l => l.id === selected)

  // ── Helpers de grilla ────────────────────────────────────────────────────
  const cellFromEvent = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const col = Math.floor(x / CELL_PX) + 1
    const row = Math.floor(y / CELL_PX) + 1
    if (col < 1 || col > GRID_COLS || row < 1 || row > GRID_ROWS) return null
    return { col, row }
  }, [])

  const isCellOccupied = useCallback((col, row, excludeId = null) => {
    return locations.some(l => {
      if (l.id === excludeId) return false
      return col >= l.col && col < l.col + l.w &&
             row >= l.row && row < l.row + l.h
    })
  }, [locations])

  const canPlace = useCallback((col, row, w, h, excludeId = null) => {
    if (col < 1 || row < 1 || col + w - 1 > GRID_COLS || row + h - 1 > GRID_ROWS) return false
    for (let c = col; c < col + w; c++)
      for (let r = row; r < row + h; r++)
        if (isCellOccupied(c, r, excludeId)) return false
    return true
  }, [isCellOccupied])

  // ── Click en canvas ──────────────────────────────────────────────────────
  const handleCanvasClick = useCallback((e) => {
    const cell = cellFromEvent(e)
    if (!cell) return

    if (mode === 'add') {
      const label = addLabel.trim() || `UB-${uid()}`
      const newLoc = { id: uid(), col: cell.col, row: cell.row, w: 1, h: 1, tipo: addTipo, label, productos: [] }
      if (!canPlace(cell.col, cell.row, 1, 1)) return
      setLocations(prev => [...prev, newLoc])
      setAddLabel('')
      return
    }

    if (mode === 'delete') {
      const hit = locations.find(l =>
        cell.col >= l.col && cell.col < l.col + l.w &&
        cell.row >= l.row && cell.row < l.row + l.h
      )
      if (hit) setLocations(prev => prev.filter(l => l.id !== hit.id))
      return
    }

    // mode === 'view' → seleccionar
    const hit = locations.find(l =>
      cell.col >= l.col && cell.col < l.col + l.w &&
      cell.row >= l.row && cell.row < l.row + l.h
    )
    setSelected(hit ? hit.id : null)
  }, [mode, addTipo, addLabel, locations, canPlace, cellFromEvent])

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e, loc) => {
    if (mode !== 'view') return
    const cell = cellFromEvent(e)
    if (!cell) return
    const offCol = cell.col - loc.col
    const offRow = cell.row - loc.row
    setDragging({ id: loc.id, offCol, offRow })
    e.dataTransfer.effectAllowed = 'move'
  }, [mode, cellFromEvent])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    const cell = cellFromEvent(e)
    if (cell) setDragOver(cell)
  }, [cellFromEvent])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    if (!dragging) return
    const cell = cellFromEvent(e)
    if (!cell) { setDragging(null); setDragOver(null); return }
    const loc = locations.find(l => l.id === dragging.id)
    if (!loc) { setDragging(null); setDragOver(null); return }
    const newCol = cell.col - dragging.offCol
    const newRow = cell.row - dragging.offRow
    if (canPlace(newCol, newRow, loc.w, loc.h, dragging.id)) {
      setLocations(prev => prev.map(l =>
        l.id === dragging.id ? { ...l, col: newCol, row: newRow } : l
      ))
    }
    setDragging(null)
    setDragOver(null)
  }, [dragging, locations, canPlace, cellFromEvent])

  // ── Edit modal ───────────────────────────────────────────────────────────
  const openEdit = (loc) => { setEditLoc({ ...loc }); setShowModal(true) }

  const saveEdit = () => {
    setLocations(prev => prev.map(l => l.id === editLoc.id ? { ...editLoc } : l))
    setSelected(editLoc.id)
    setShowModal(false)
  }

  // ── Renderizado de ubicaciones ───────────────────────────────────────────
  const renderLocation = (loc) => {
    const isDraggingThis = dragging?.id === loc.id
    const col = TIPO_COLORES[loc.tipo] || TIPO_COLORES.estante
    const isSelected = selected === loc.id
    const style = {
      position: 'absolute',
      left:  (loc.col - 1) * CELL_PX + 2,
      top:   (loc.row - 1) * CELL_PX + 2,
      width:  loc.w * CELL_PX - 4,
      height: loc.h * CELL_PX - 4,
    }
    const hasVencido = loc.productos.some(p => p.estado === 'VENCIDO')
    const hasCuarentena = loc.productos.some(p => p.estado === 'CUARENTENA')

    return (
      <div
        key={loc.id}
        style={style}
        draggable={mode === 'view'}
        onDragStart={(e) => handleDragStart(e, loc)}
        onClick={(e) => { e.stopPropagation(); if (mode === 'view') setSelected(loc.id); if (mode === 'delete') setLocations(prev => prev.filter(l => l.id !== loc.id)) }}
        className={`
          rounded-md border cursor-pointer select-none transition-all duration-150
          ${col.bg} ${col.border}
          ${isSelected ? 'ring-2 ring-primary ring-offset-1 ring-offset-bg' : ''}
          ${isDraggingThis ? 'opacity-40' : 'opacity-100'}
          ${mode === 'delete' ? 'hover:bg-red-500/30 hover:border-red-500' : 'hover:brightness-125'}
          flex flex-col items-center justify-center gap-0.5 overflow-hidden p-1
        `}
      >
        <span className="text-[10px] font-bold text-foreground leading-none text-center truncate w-full text-center px-1">
          {loc.label}
        </span>
        <span className="text-[9px] text-muted leading-none">{TIPO_COLORES[loc.tipo]?.label}</span>
        {loc.productos.length > 0 && (
          <span className="text-[9px] font-semibold text-foreground/70">
            {loc.productos.reduce((s, p) => s + (p.qty || 0), 0)} u
          </span>
        )}
        {hasVencido && <span className="text-[9px] leading-none">🚨</span>}
        {hasCuarentena && !hasVencido && <span className="text-[9px] leading-none">⚠️</span>}
      </div>
    )
  }

  const totalProductos = locations.reduce((s, l) => s + l.productos.length, 0)
  const totalUnidades  = locations.reduce((s, l) => s + l.productos.reduce((ss, p) => ss + (p.qty || 0), 0), 0)

  return (
    <div className="space-y-4">

      {/* Header + controles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Mapa de Bodega</h2>
          <p className="text-xs text-muted">{locations.length} ubicaciones · {totalProductos} productos · {totalUnidades.toLocaleString()} unidades</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Modo */}
          {(['view','add','delete']).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setSelected(null) }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                mode === m
                  ? m === 'delete' ? 'bg-red-500/20 border-red-500/50 text-red-400'
                    : 'bg-primary/20 border-primary/50 text-primary'
                  : 'border-border text-muted hover:text-foreground'
              }`}
            >
              {m === 'view' ? '👁 Ver' : m === 'add' ? '＋ Agregar' : '🗑 Eliminar'}
            </button>
          ))}
        </div>
      </div>

      {/* Panel agregar */}
      {mode === 'add' && (
        <div className="flex flex-wrap gap-3 p-3 rounded-lg border border-border bg-surface text-xs items-end">
          <div>
            <label className="block text-muted mb-1">Tipo</label>
            <select value={addTipo} onChange={e => setAddTipo(e.target.value)}
              className="bg-bg border border-border rounded-md px-2 py-1.5 text-foreground text-xs">
              {Object.entries(TIPO_COLORES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-muted mb-1">Etiqueta</label>
            <input value={addLabel} onChange={e => setAddLabel(e.target.value)}
              placeholder="Ej: B-03"
              className="bg-bg border border-border rounded-md px-2 py-1.5 text-foreground text-xs w-28" />
          </div>
          <p className="text-muted">Haz clic en una celda vacía del plano para colocar la ubicación.</p>
        </div>
      )}
      {mode === 'delete' && (
        <div className="px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-400">
          Haz clic sobre una ubicación en el plano para eliminarla.
        </div>
      )}

      {/* Layout principal: canvas + panel lateral */}
      <div className="flex gap-4 items-start">

        {/* Canvas */}
        <div className="flex-1 overflow-auto">
          <div
            ref={canvasRef}
            onClick={handleCanvasClick}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{
              position: 'relative',
              width:  GRID_COLS * CELL_PX,
              height: GRID_ROWS * CELL_PX,
              minWidth: GRID_COLS * CELL_PX,
            }}
            className="border border-border rounded-lg bg-bg/60 cursor-crosshair"
          >
            {/* Grilla */}
            {Array.from({ length: GRID_ROWS }, (_, r) =>
              Array.from({ length: GRID_COLS }, (_, c) => {
                const col = c + 1; const row = r + 1
                const isTarget = dragOver && dragging &&
                  (() => {
                    const loc = locations.find(l => l.id === dragging.id)
                    if (!loc) return false
                    const nc = dragOver.col - dragging.offCol
                    const nr = dragOver.row - dragging.offRow
                    return col >= nc && col < nc + loc.w && row >= nr && row < nr + loc.h
                  })()
                return (
                  <div key={`${c}-${r}`} style={{
                    position: 'absolute',
                    left: c * CELL_PX, top: r * CELL_PX,
                    width: CELL_PX, height: CELL_PX,
                  }}
                    className={`border border-border/20 ${
                      isTarget
                        ? canPlace(
                            dragOver.col - dragging.offCol,
                            dragOver.row - dragging.offRow,
                            locations.find(l => l.id === dragging.id)?.w || 1,
                            locations.find(l => l.id === dragging.id)?.h || 1,
                            dragging.id
                          )
                          ? 'bg-primary/10'
                          : 'bg-red-500/10'
                        : ''
                    }`}
                  />
                )
              })
            )}

            {/* Etiquetas de columnas */}
            {Array.from({ length: GRID_COLS }, (_, c) => (
              <div key={c} style={{ position:'absolute', left: c * CELL_PX, top: -18, width: CELL_PX }}
                className="text-center text-[9px] text-muted/50 font-mono">
                {c + 1}
              </div>
            ))}
            {/* Etiquetas de filas */}
            {Array.from({ length: GRID_ROWS }, (_, r) => (
              <div key={r} style={{ position:'absolute', top: r * CELL_PX, left: -18, height: CELL_PX }}
                className="flex items-center justify-center text-[9px] text-muted/50 font-mono">
                {String.fromCharCode(65 + r)}
              </div>
            ))}

            {/* Ubicaciones */}
            {locations.map(renderLocation)}
          </div>
        </div>

        {/* Panel lateral: detalle ubicación seleccionada */}
        <div className="w-64 shrink-0">
          {selectedLoc ? (
            <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Ubicación</p>
                  <p className="font-semibold text-foreground text-sm">{selectedLoc.label}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(selectedLoc)}
                    className="text-[10px] px-2 py-1 rounded border border-border text-muted hover:text-foreground transition-colors">
                    ✏️ Editar
                  </button>
                  <button onClick={() => { setLocations(prev => prev.filter(l => l.id !== selectedLoc.id)); setSelected(null) }}
                    className="text-[10px] px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
                    🗑
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-muted uppercase tracking-wide block">Tipo</span>
                  <span className="text-foreground font-medium">{TIPO_COLORES[selectedLoc.tipo]?.label}</span>
                </div>
                <div>
                  <span className="text-muted uppercase tracking-wide block">Posición</span>
                  <span className="text-foreground font-medium">
                    {String.fromCharCode(64 + selectedLoc.row)}{selectedLoc.col}
                  </span>
                </div>
                <div>
                  <span className="text-muted uppercase tracking-wide block">Dimensión</span>
                  <span className="text-foreground font-medium">{selectedLoc.w}×{selectedLoc.h} celdas</span>
                </div>
                <div>
                  <span className="text-muted uppercase tracking-wide block">Productos</span>
                  <span className="text-foreground font-medium">{selectedLoc.productos.length}</span>
                </div>
              </div>

              {selectedLoc.productos.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-muted uppercase tracking-wide">Productos en ubicación</p>
                  {selectedLoc.productos.map((p, i) => (
                    <div key={i} className="p-2 rounded-lg border border-border bg-bg text-[10px] space-y-0.5">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium text-foreground truncate">{p.nombre}</span>
                        <span className={`px-1.5 py-0.5 rounded-full border font-semibold shrink-0 ${
                          ESTADO_BADGE[p.estado] ?? 'bg-white/5 text-muted border-border'
                        }`}>{p.estado}</span>
                      </div>
                      <div className="flex gap-3 text-muted">
                        <span>SKU: <span className="text-foreground">{p.sku}</span></span>
                        <span>Qty: <span className="text-foreground font-bold">{p.qty}</span></span>
                      </div>
                      <div className="text-muted">Lote: <span className="text-foreground">{p.lote}</span></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center py-4 text-muted">
                  <span className="text-2xl opacity-20 mb-1">📦</span>
                  <p className="text-[10px]">Sin productos asignados</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-xl p-6 flex flex-col items-center justify-center text-muted gap-2">
              <span className="text-3xl opacity-20">🗺️</span>
              <p className="text-xs text-center">Selecciona una ubicación en el plano para ver su detalle</p>
            </div>
          )}

          {/* Leyenda */}
          <div className="mt-3 p-3 bg-surface border border-border rounded-xl">
            <p className="text-[10px] text-muted uppercase tracking-wide mb-2">Leyenda</p>
            <div className="space-y-1.5">
              {Object.entries(TIPO_COLORES).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded border ${v.bg} ${v.border} shrink-0`} />
                  <span className="text-[10px] text-foreground">{v.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-border space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px]">🚨</span><span className="text-[10px] text-red-400">Lote vencido</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px]">⚠️</span><span className="text-[10px] text-yellow-400">En cuarentena</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal editar ubicación */}
      {showModal && editLoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowModal(false)}>
          <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm space-y-4 shadow-xl"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-foreground text-sm">Editar Ubicación</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Etiqueta</label>
                <input value={editLoc.label} onChange={e => setEditLoc(p => ({ ...p, label: e.target.value }))}
                  className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-foreground text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Tipo</label>
                <select value={editLoc.tipo} onChange={e => setEditLoc(p => ({ ...p, tipo: e.target.value }))}
                  className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-foreground text-sm">
                  {Object.entries(TIPO_COLORES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Ancho (celdas)</label>
                  <input type="number" min={1} max={GRID_COLS} value={editLoc.w}
                    onChange={e => setEditLoc(p => ({ ...p, w: parseInt(e.target.value) || 1 }))}
                    className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-foreground text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Alto (celdas)</label>
                  <input type="number" min={1} max={GRID_ROWS} value={editLoc.h}
                    onChange={e => setEditLoc(p => ({ ...p, h: parseInt(e.target.value) || 1 }))}
                    className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-foreground text-sm" />
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setShowModal(false)}
                className="px-4 py-1.5 text-xs border border-border text-muted rounded-md hover:text-foreground transition-colors">
                Cancelar
              </button>
              <button onClick={saveEdit}
                className="px-4 py-1.5 text-xs bg-primary text-white rounded-md hover:bg-primary/80 transition-colors">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
