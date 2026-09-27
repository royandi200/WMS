import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Save, Search } from 'lucide-react'
import { listAlertSettings, updateAlertSettings } from '../api/alertSettings.api'
import { listReceptionLotRules, updateReceptionLotRule } from '../api/receptionLotRules.api'

function todayBogota() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function lotPreview(date, days, initials) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(Number(days)) || !/^[A-Z]{1,8}$/.test(initials)) return ''
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() - Number(days))
  const day = String(value.getUTCDate()).padStart(2, '0')
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  return `R41-01-${day}${month}${value.getUTCFullYear()}-${initials}`
}

function normalizeDraft(row) {
  return {
    stock_minimo: String(row.stock_minimo ?? 0),
    permanencia_max_dias: String(row.permanencia_max_dias ?? 90),
  }
}

export default function AlertSettingsPage({ embedded = false }) {
  const [rows, setRows] = useState([])
  const [drafts, setDrafts] = useState({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [message, setMessage] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [lotRules, setLotRules] = useState([])
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState('')
  const [initials, setInitials] = useState('')
  const [offsetDays, setOffsetDays] = useState('4')
  const [ruleEnabled, setRuleEnabled] = useState(true)
  const [exampleDate, setExampleDate] = useState(todayBogota)
  const [savingRule, setSavingRule] = useState(false)

  const load = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const [payload, lotPayload] = await Promise.all([listAlertSettings(), listReceptionLotRules()])
      const nextRows = payload?.data?.rows || []
      setRows(nextRows)
      setDrafts(Object.fromEntries(nextRows.map((row) => [row.id, normalizeDraft(row)])))
      setSuppliers(lotPayload?.data?.suppliers || [])
      setLotRules(lotPayload?.data?.rules || [])
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
    return rows.filter((row) => [
      row.sku,
      row.nombre,
      ...(row.aliases || []),
      ...(row.proveedores || []),
      ...(row.clientes || []),
    ].some((value) => String(value || '').toLowerCase().includes(term)))
  }, [rows, search])

  useEffect(() => {
    const rule = lotRules.find((item) => String(item.producto_id) === selectedProduct
      && String(item.tercero_id) === selectedSupplier)
    setInitials(rule?.sigla || '')
    setOffsetDays(String(rule?.dias_retroceso ?? 4))
    setRuleEnabled(rule ? Boolean(Number(rule.activa)) : true)
  }, [selectedProduct, selectedSupplier, lotRules])

  const saveLotRule = async (event) => {
    event.preventDefault()
    setSavingRule(true)
    setMessage(null)
    try {
      await updateReceptionLotRule({ producto_id: Number(selectedProduct),
        tercero_id: Number(selectedSupplier), sigla: initials.trim().toUpperCase(),
        dias_retroceso: Number(offsetDays), activa: ruleEnabled })
      const payload = await listReceptionLotRules()
      setLotRules(payload?.data?.rules || [])
      setMessage({ ok: true, text: ruleEnabled
        ? 'Regla guardada. Este SKU y proveedor usarán un lote interno en las nuevas recepciones.'
        : 'Regla desactivada. En las nuevas recepciones se exigirá el lote del proveedor.' })
    } catch (error) {
      setMessage({ ok: false, text: error.response?.data?.error || 'No fue posible guardar la regla de lote' })
    } finally {
      setSavingRule(false)
    }
  }

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
      setMessage({ ok: false, text: `Stock mínimo inválido para ${row.sku}` })
      return
    }
    if (!Number.isInteger(dwellDays) || dwellDays < 1 || dwellDays > 3650) {
      setMessage({ ok: false, text: `La permanencia de ${row.sku} debe estar entre 1 y 3650 días` })
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
        {embedded ? <h2 className="text-lg md:text-xl font-semibold text-foreground">Configuración operativa por SKU</h2>
          : <h1 className="text-lg md:text-xl font-semibold text-foreground">Configuración operativa por SKU</h1>}
        <p className="text-xs text-muted mt-1">Alertas y reglas de lote de recepción. Cambiar estas opciones no modifica inventario existente.</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 mb-5 border-y border-border py-4">
        <label className="text-xs text-muted w-full max-w-md">
          Buscar SKU, producto, alias, proveedor o cliente
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
        <p>El stock mínimo se expresa en la unidad del SKU. La permanencia máxima genera una alerta cuando un lote conserva saldo durante ese número de días.</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="bg-surface border-b border-border">
              {['SKU', 'Producto', 'Disponible', 'Stock mínimo', 'Permanencia máxima', 'Acción'].map((label) => (
                <th key={label} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">Cargando configuración...</td></tr>}
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
                    {!!row.aliases?.length && <span className="block text-xs text-muted mt-1"><span className="text-foreground/80">Alias:</span> {row.aliases.join(', ')}</span>}
                    {!!row.proveedores?.length && <span className="block text-xs text-muted mt-1"><span className="text-foreground/80">Proveedor:</span> {row.proveedores.join(', ')}</span>}
                    {!!row.clientes?.length && <span className="block text-xs text-muted mt-1"><span className="text-foreground/80">Clientes:</span> {row.clientes.join(', ')}</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{row.disponible} {row.unidad}</td>
                  <td className="px-4 py-3">
                    <input type="number" min="0" step="0.0001" value={draft.stock_minimo} onChange={(event) => setField(row.id, 'stock_minimo', event.target.value)} className="input-field w-36 tabular-nums" aria-label={`Stock mínimo de ${row.sku}`} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input type="number" min="1" max="3650" step="1" value={draft.permanencia_max_dias} onChange={(event) => setField(row.id, 'permanencia_max_dias', event.target.value)} className="input-field w-28 tabular-nums" aria-label={`Permanencia máxima de ${row.sku}`} />
                      <span className="text-xs text-muted">días</span>
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
      <section className="mt-8 border border-border rounded-lg bg-surface p-4 md:p-5">
        <h3 className="text-base font-semibold text-foreground">Lote automático al recibir sin lote del proveedor</h3>
        <p className="mt-1 text-xs text-muted">Configura cada combinación de SKU y proveedor que normalmente llega sin lote. Mientras la regla esté activa, el WMS generará y validará el lote interno antes de confirmar; si el proveedor comienza a informar un lote físico, desactiva la regla. El vencimiento siempre se solicita.</p>
        <form onSubmit={saveLotRule} className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="text-xs text-muted">SKU
            <select required className="input-field mt-1 w-full" value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)}>
              <option value="">Selecciona un SKU</option>
              {rows.map((row) => <option key={row.id} value={row.id}>{row.sku} — {row.nombre}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">Proveedor
            <select required className="input-field mt-1 w-full" value={selectedSupplier} onChange={(event) => setSelectedSupplier(event.target.value)}>
              <option value="">Selecciona un proveedor</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.nombre}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">Sigla (por ejemplo, CA)
            <input required maxLength={8} pattern="[A-Za-z]{1,8}" value={initials} onChange={(event) => setInitials(event.target.value.toUpperCase())} className="input-field mt-1 w-full" />
          </label>
          <label className="text-xs text-muted">Días calendario a restar
            <input required type="number" min="0" max="365" step="1" value={offsetDays} onChange={(event) => setOffsetDays(event.target.value)} className="input-field mt-1 w-full" />
          </label>
          <label className="text-xs text-muted">Fecha de ejemplo
            <input type="date" value={exampleDate} onChange={(event) => setExampleDate(event.target.value)} className="input-field mt-1 w-full" />
          </label>
          <div className="text-xs text-muted self-end">Vista previa (R41 y partida 01 de ejemplo):
            <span className="block mt-1 font-mono text-sm text-primary">{lotPreview(exampleDate, offsetDays, initials) || 'Completa fecha, días y sigla'}</span>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground self-end">
            <input type="checkbox" checked={ruleEnabled} onChange={(event) => setRuleEnabled(event.target.checked)} /> Regla activa
          </label>
          <button type="submit" disabled={savingRule || !selectedProduct || !selectedSupplier} className="btn-primary self-end disabled:opacity-40">{savingRule ? 'Guardando...' : 'Guardar regla'}</button>
        </form>
        {!!lotRules.length && <div className="mt-5 text-xs text-muted">
          <p className="font-semibold text-foreground mb-2">Reglas configuradas</p>
          {lotRules.map((rule) => <p key={`${rule.producto_id}:${rule.tercero_id}`} className="py-1 border-t border-border/50">
            {rule.sku} · {rule.proveedor} · {rule.activa ? 'Activa' : 'Inactiva'} · restar {rule.dias_retroceso} días · sigla {rule.sigla}
          </p>)}
        </div>}
      </section>
    </div>
  )
}
