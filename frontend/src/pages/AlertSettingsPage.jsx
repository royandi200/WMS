import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Save, Search } from 'lucide-react'
import { listAlertSettings, updateAlertSettings } from '../api/alertSettings.api'

function normalizeDraft(row) {
  return {
    stock_minimo: String(row.stock_minimo ?? 0),
    permanencia_max_dias: String(row.permanencia_max_dias ?? 90),
  }
}

export default function AlertSettingsPage() {
  const [rows, setRows] = useState([])
  const [drafts, setDrafts] = useState({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [message, setMessage] = useState(null)

  const load = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const payload = await listAlertSettings()
      const nextRows = payload?.data?.rows || []
      setRows(nextRows)
      setDrafts(Object.fromEntries(nextRows.map((row) => [row.id, normalizeDraft(row)])))
    } catch (error) {
      setMessage({ ok: false, text: error.response?.data?.error || 'No fue posible cargar los umbrales' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((row) => row.sku.toLowerCase().includes(term) || row.nombre.toLowerCase().includes(term))
  }, [rows, search])

  const setField = (id, field, value) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }))
  }

  const isDirty = (row) => {
    const draft = drafts[row.id] || normalizeDraft(row)
    return Number(draft.stock_minimo) !== Number(row.stock_minimo)
      || Number(draft.permanencia_max_dias) !== Number(row.permanencia_max_dias)
  }

  const save = async (row) => {
    const draft = drafts[row.id]
    const minimum = Number(draft?.stock_minimo)
    const dwellDays = Number(draft?.permanencia_max_dias)
    if (!Number.isFinite(minimum) || minimum < 0) {
      setMessage({ ok: false, text: `Stock minimo invalido para ${row.sku}` })
      return
    }
    if (!Number.isInteger(dwellDays) || dwellDays < 1 || dwellDays > 3650) {
      setMessage({ ok: false, text: `La permanencia de ${row.sku} debe estar entre 1 y 3650 dias` })
      return
    }
    setSavingId(row.id)
    setMessage(null)
    try {
      const payload = await updateAlertSettings({
        product_id: row.id,
        stock_minimo: minimum,
        permanencia_max_dias: dwellDays,
      })
      const saved = payload?.data
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, ...saved } : item))
      setDrafts((current) => ({ ...current, [row.id]: normalizeDraft(saved) }))
      setMessage({ ok: true, text: `Umbrales de ${row.sku} actualizados` })
    } catch (error) {
      setMessage({ ok: false, text: error.response?.data?.error || 'No fue posible guardar los umbrales' })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg md:text-xl font-semibold text-foreground">Configuracion de alertas</h1>
        <p className="text-xs text-muted mt-1">Umbrales operativos por SKU. Estos cambios no modifican saldos ni movimientos de inventario.</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 mb-5 border-y border-border py-4">
        <label className="text-xs text-muted w-full max-w-md">
          Buscar SKU o producto
          <span className="relative block mt-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="input-field pl-9" placeholder="Ej: 00102 o Ashwagandha" />
          </span>
        </label>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 border border-border text-sm text-muted hover:text-foreground disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {message && <div className={`mb-4 px-4 py-3 border text-sm ${message.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'}`}>{message.text}</div>}

      <div className="mb-4 flex items-start gap-2 text-xs text-muted">
        <AlertTriangle size={15} className="mt-0.5 text-yellow-400 flex-shrink-0" />
        <p>Stock minimo se expresa en la unidad del SKU. Permanencia maxima genera alerta cuando un lote conserva saldo durante ese numero de dias.</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="bg-surface border-b border-border">
              {['SKU', 'Producto', 'Disponible', 'Stock minimo', 'Permanencia maxima', 'Accion'].map((label) => (
                <th key={label} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">Cargando configuracion...</td></tr>}
            {!loading && visibleRows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No hay productos para este filtro</td></tr>}
            {!loading && visibleRows.map((row) => {
              const draft = drafts[row.id] || normalizeDraft(row)
              const dirty = isDirty(row)
              return (
                <tr key={row.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono text-xs text-primary">{row.sku}</td>
                  <td className="px-4 py-3">
                    <span className="block font-medium text-foreground">{row.nombre}</span>
                    <span className="block text-xs text-muted mt-0.5">Unidad: {row.unidad}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{row.disponible} {row.unidad}</td>
                  <td className="px-4 py-3">
                    <input type="number" min="0" step="0.0001" value={draft.stock_minimo} onChange={(event) => setField(row.id, 'stock_minimo', event.target.value)} className="input-field w-36 tabular-nums" aria-label={`Stock minimo de ${row.sku}`} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input type="number" min="1" max="3650" step="1" value={draft.permanencia_max_dias} onChange={(event) => setField(row.id, 'permanencia_max_dias', event.target.value)} className="input-field w-28 tabular-nums" aria-label={`Permanencia maxima de ${row.sku}`} />
                      <span className="text-xs text-muted">dias</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => save(row)} disabled={!dirty || savingId === row.id} className="btn-primary inline-flex items-center gap-2 disabled:opacity-40">
                      <Save size={15} /> {savingId === row.id ? 'Guardando' : 'Guardar'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
