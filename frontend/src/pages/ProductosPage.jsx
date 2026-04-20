import { useEffect, useState } from 'react'
import { useProductsStore } from '../store/productsStore'

const TYPES = ['MATERIA_PRIMA','PRODUCTO_TERMINADO','INSUMO','EMPAQUE']
const TYPE_COLOR = {
  MATERIA_PRIMA:     'text-blue-400  bg-blue-400/10',
  PRODUCTO_TERMINADO:'text-green-400 bg-green-400/10',
  INSUMO:            'text-yellow-400 bg-yellow-400/10',
  EMPAQUE:           'text-purple-400 bg-purple-400/10',
}

const EMPTY_FORM = {
  sku: '', name: '', description: '', type: TYPES[0],
  unit: 'und', min_stock: '0', max_stock: '0',
}

const TABS = ['Catálogo', 'Nuevo producto']

const SEMAFORO_STYLE = {
  OK:       'text-green-400 bg-green-400/10 border-green-400/20',
  ATENCION: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  CRITICO:  'text-red-400 bg-red-400/10 border-red-400/20',
}

export default function ProductosPage() {
  const [tab,      setTab]      = useState(0)
  const [search,   setSearch]   = useState('')
  const [typeF,    setTypeF]    = useState('')
  const [expanded, setExpanded] = useState(null)
  const [editing,  setEditing]  = useState(null)
  const [form,     setForm]     = useState(EMPTY_FORM)
  const [toast,    setToast]    = useState(null)

  const { list, loading, error, fetchList, create, update, toggle, clearError } = useProductsStore()

  useEffect(() => { fetchList() }, [])

  const showToast = (msg, ok) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 4000) }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const filtered = list.filter((p) => {
    const q = search.toLowerCase()
    const matchSearch = !q || p.sku?.toLowerCase().includes(q) || p.name?.toLowerCase().includes(q)
    const matchType = !typeF || p.type === typeF
    return matchSearch && matchType
  })

  const startEdit = (p) => {
    setEditing(p)
    setForm({
      sku:         p.sku,
      name:        p.name,
      description: p.description || '',
      type:        p.type,
      unit:        p.unit,
      min_stock:   String(p.min_stock ?? 0),
      max_stock:   String(p.max_stock ?? 0),
    })
    setTab(1)
  }

  const cancelEdit = () => { setEditing(null); setForm(EMPTY_FORM); clearError() }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const body = {
      sku:         form.sku.trim(),
      name:        form.name.trim(),
      description: form.description.trim() || undefined,
      type:        form.type,
      unit:        form.unit.trim() || 'und',
      min_stock:   Number(form.min_stock),
      max_stock:   Number(form.max_stock),
    }
    const res = editing ? await update(editing.id, body) : await create(body)
    if (res.ok) {
      showToast(editing ? '✓ Producto actualizado' : '✓ Producto creado', true)
      setEditing(null); setForm(EMPTY_FORM); setTab(0)
    } else {
      showToast(res.message, false)
    }
  }

  const handleToggle = async (p) => {
    const res = await toggle(p.id)
    if (!res.ok) showToast(res.message, false)
  }

  return (
    <div>
      <h1 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Productos</h1>

      <div className="flex gap-1 mb-4 md:mb-6 border-b border-border overflow-x-auto pb-px scrollbar-none">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => { setTab(i); if (i === 0) cancelEdit() }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === i ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'
            }`}>
            {i === 1 && editing ? 'Editar producto' : t}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">{error}</div>}
      {toast && (
        <div className={`mb-4 px-4 py-3 rounded-lg border text-sm ${
          toast.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'
        }`}>{toast.msg}</div>
      )}

      {tab === 0 && (
        <div>
          <div className="flex flex-wrap gap-3 mb-5">
            <div>
              <label className="block text-xs text-muted mb-1">Buscar SKU / nombre</label>
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="RM-TAP-MED…" className="input-field py-1.5 w-52" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Tipo</label>
              <select value={typeF} onChange={(e) => setTypeF(e.target.value)} className="input-field py-1.5 pr-8">
                <option value="">Todos</option>
                {TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="self-end">
              <button onClick={() => fetchList()} disabled={loading}
                className="px-4 py-[9px] bg-surface border border-border hover:border-primary/50 text-sm text-muted hover:text-foreground rounded-md transition-colors disabled:opacity-50">
                {loading ? '...' : '↺ Recargar'}
              </button>
            </div>
          </div>

          {loading && <Spinner />}

          {!loading && filtered.length === 0 && (
            <EmptyState icon="▦" text={search || typeF ? 'Sin resultados para ese filtro' : 'No hay productos registrados'} />
          )}

          {!loading && filtered.length > 0 && (
            <div className="space-y-2">
              {filtered.map((p) => (
                <div key={p.id} className={`bg-surface border rounded-lg overflow-hidden transition-colors ${
                  p.active ? 'border-border' : 'border-border/40 opacity-60'
                }`}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                      className="text-muted hover:text-foreground transition-colors text-xs w-4"
                    >
                      {expanded === p.id ? '▲' : '▼'}
                    </button>

                    <span className={`hidden sm:inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
                      TYPE_COLOR[p.type] || 'text-muted bg-white/5'
                    }`}>
                      {p.type?.replace('_', ' ')}
                    </span>

                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-sm text-primary font-semibold">{p.sku}</span>
                      <span className="text-foreground text-sm ml-2 truncate">{p.name}</span>
                    </div>

                    <div className="hidden xl:grid grid-cols-4 gap-4 text-xs text-muted tabular-nums min-w-[420px]">
                      <span>Disp <strong className="text-foreground">{p.disponible ?? 0}</strong></span>
                      <span>Cuar <strong className="text-foreground">{p.cuarentena ?? 0}</strong></span>
                      <span>Res <strong className="text-foreground">{p.reservado ?? 0}</strong></span>
                      <span>Total <strong className="text-foreground">{p.total_fisico ?? 0}</strong></span>
                    </div>

                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                      SEMAFORO_STYLE[p.semaforo] || 'text-muted bg-white/5 border-border'
                    }`}>
                      {p.semaforo || 'OK'}
                    </span>

                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      p.active ? 'text-green-400 bg-green-400/10' : 'text-muted bg-white/5'
                    }`}>
                      {p.active ? 'Activo' : 'Inactivo'}
                    </span>

                    <div className="flex gap-1">
                      <button
                        onClick={() => startEdit(p)}
                        className="text-xs px-2 py-1 border border-border rounded hover:border-primary/50 text-muted hover:text-foreground transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleToggle(p)}
                        className={`text-xs px-2 py-1 border rounded transition-colors ${
                          p.active
                            ? 'border-danger/30 text-danger hover:bg-danger/10'
                            : 'border-green-500/30 text-green-400 hover:bg-green-500/10'
                        }`}
                      >
                        {p.active ? 'Inactivar' : 'Activar'}
                      </button>
                    </div>
                  </div>

                  {expanded === p.id && (
                    <div className="border-t border-border/50 px-4 py-3 space-y-4 text-xs">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Detail label="Disponible" value={p.disponible ?? 0} />
                        <Detail label="Cuarentena" value={p.cuarentena ?? 0} />
                        <Detail label="Reservado" value={p.reservado ?? 0} />
                        <Detail label="Total físico" value={p.total_fisico ?? 0} />
                        <Detail label="Lotes activos" value={p.lotes_activos ?? 0} />
                        <Detail label="Próx. vencimiento" value={p.proximo_vencimiento || '—'} />
                        <Detail label="Últ. movimiento" value={p.ultimo_movimiento || '—'} />
                        <Detail label="Semáforo" value={p.semaforo || 'OK'} />
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <Detail label="ID" value={p.id} mono />
                        <Detail label="Descripción" value={p.description || '—'} />
                        <Detail label="SIIGO ID" value={p.siigo_id || '—'} />
                        <Detail label="SIIGO Code" value={p.siigo_code || '—'} />
                        <Detail label="SIIGO Activo" value={p.siigo_active ? 'Sí' : 'No'} />
                        <Detail label="Últ. sync" value={p.siigo_sync_at?.slice(0,10) || '—'} />
                        <Detail label="Creado" value={p.createdAt?.slice(0,10) || p.created_at?.slice(0,10) || '—'} />
                        <Detail label="Unidad" value={p.unit || 'und'} />
                        <Detail label="Stock mínimo" value={p.min_stock ?? 0} />
                        <Detail label="Stock máximo" value={p.max_stock ?? 0} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {filtered.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              {filtered.length} producto{filtered.length !== 1 ? 's' : ''} mostrado{filtered.length !== 1 ? 's' : ''}
              {(search || typeF) ? ` (filtrado de ${list.length})` : ''}
            </p>
          )}
        </div>
      )}

      {tab === 1 && (
        <form onSubmit={handleSubmit} className="max-w-xl bg-surface border border-border rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="SKU *"><input value={form.sku} onChange={set('sku')} placeholder="RM-TAP-MED" className="input-field" required disabled={!!editing} /></Field>
            <Field label="Unidad *"><input value={form.unit} onChange={set('unit')} placeholder="und / kg / lt" className="input-field" required /></Field>
          </div>
          <Field label="Nombre *"><input value={form.name} onChange={set('name')} placeholder="Nombre del producto" className="input-field" required /></Field>
          <Field label="Tipo *">
            <select value={form.type} onChange={set('type')} className="input-field">
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Descripción">
            <textarea value={form.description} onChange={set('description')} placeholder="Descripción opcional" rows={2} className="input-field resize-none" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Stock mínimo"><input type="number" min="0" step="0.001" value={form.min_stock} onChange={set('min_stock')} placeholder="0" className="input-field" /></Field>
            <Field label="Stock máximo"><input type="number" min="0" step="0.001" value={form.max_stock} onChange={set('max_stock')} placeholder="0" className="input-field" /></Field>
          </div>
          {editing && (
            <p className="text-xs text-muted bg-yellow-400/5 border border-yellow-400/20 rounded px-3 py-2">
              ✎ Editando: <strong className="text-yellow-400 font-mono">{editing.sku}</strong> — el SKU no se puede cambiar
            </p>
          )}
          <div className="flex gap-3">
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              {loading ? <><Spin /> {editing ? 'Actualizando…' : 'Creando…'}</> : editing ? 'Guardar cambios' : 'Crear producto'}
            </button>
            {editing && (
              <button type="button" onClick={cancelEdit}
                className="px-4 py-2 text-sm border border-border rounded-md text-muted hover:text-foreground transition-colors">
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}

function Detail({ label, value, mono }) {
  return <div><p className="text-muted mb-0.5">{label}</p><p className={`text-foreground ${mono ? 'font-mono break-all' : ''}`}>{value}</p></div>
}
function Field({ label, children }) {
  return <div><label className="block text-xs font-medium text-muted mb-1">{label}</label>{children}</div>
}
function EmptyState({ icon, text }) {
  return <div className="flex flex-col items-center justify-center py-16 text-muted"><span className="text-4xl mb-3 opacity-30">{icon}</span><p className="text-sm">{text}</p></div>
}
function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
}
function Spin() {
  return <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
}
