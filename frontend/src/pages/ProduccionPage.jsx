import { useEffect, useState } from 'react'
import { useProductionStore } from '../store/productionStore'
import { listUbicaciones } from '../api/inventory.api'
import { useAuthStore } from '../store/authStore'

const PHASES = ['F1', 'F2', 'F3', 'F4', 'F5']
const STATUS_LABEL = {
  PLANEADA: { label: 'Planeada', css: 'text-yellow-400 bg-yellow-400/10' },
  APROBADA: { label: 'Aprobada', css: 'text-emerald-400 bg-emerald-400/10' },
  EN_PROCESO: { label: 'En proceso', css: 'text-blue-400 bg-blue-400/10' },
  CERRADA: { label: 'Cerrada', css: 'text-green-400 bg-green-400/10' },
  CANCELADA: { label: 'Cancelada', css: 'text-muted bg-white/5' },
}
const TABS = ['Listado', 'Nueva orden', 'Confirmar materiales', 'Ajustar materiales', 'Avanzar fase', 'Cerrar orden']
const TAB_CAPABILITIES = ['production.read', 'production.release', 'production.pick', 'production.pick', 'production.advance', 'production.close']

const empty = '-'
const safeDate = (val) => {
  if (!val) return empty
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  return String(val).slice(0, 10)
}
const safeTime = (val) => {
  if (!val) return empty
  const text = val instanceof Date ? val.toISOString() : String(val)
  return text.includes('T') ? text.split('T')[1].slice(0, 5) : text.slice(11, 16)
}

export default function ProduccionPage() {
  const [tab, setTab] = useState(0)
  const [locations, setLocations] = useState([])
  const { list, loading, error, fetchList, start, confirm, adjustMaterials, advance, close, clearError } = useProductionStore()
  const capabilities = useAuthStore((state) => state.user?.capabilities || [])
  const visibleTabs = TABS.map((label, index) => ({ label, index, capability: TAB_CAPABILITIES[index] }))
    .filter((item) => capabilities.includes('*') || capabilities.includes(item.capability))

  useEffect(() => {
    if (!visibleTabs.some((item) => item.index === tab) && visibleTabs.length) setTab(visibleTabs[0].index)
  }, [tab, capabilities])

  useEffect(() => {
    if (tab === 0) fetchList()
    if (tab === 3 || tab === 5) listUbicaciones().then((payload) => setLocations(payload?.data?.rows || [])).catch(() => setLocations([]))
  }, [tab])

  return (
    <div>
      <h1 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Produccion</h1>

      <div className="flex gap-1 mb-4 md:mb-6 border-b border-border overflow-x-auto pb-px scrollbar-none">
        {visibleTabs.map(({ label, index }) => (
          <button
            key={label}
            onClick={() => { setTab(index); clearError() }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === index ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <Alert msg={error} />}

      {tab === 0 && (
        <div>
          {loading && <Spinner />}
          {!loading && list.length === 0 && <EmptyState text="Sin ordenes de produccion" />}
          {list.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    {['Codigo orden', 'Producto', 'SKU', 'Destino', 'Cant. plan.', 'Cant. real', 'Lote PT', 'Fase', 'Estado', 'Fecha', 'Hora'].map((c) => (
                      <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const st = STATUS_LABEL[r.status] || { label: r.status ?? empty, css: 'text-muted bg-white/5' }
                    return (
                      <tr key={r.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{r.codigo_orden ?? r.id}</td>
                        <td className="px-4 py-3 text-foreground">{r.product_name ?? empty}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted">{r.sku ?? empty}</td>
                        <td className="px-4 py-3 text-xs">{r.origen_tipo === 'OC_CLIENTE' ? `${r.referencia_cliente || 'OC'} / ${r.cliente_final || '-'}` : r.origen_tipo === 'STOCK_SEGURIDAD' ? 'Stock seguridad' : '-'}</td>
                        <td className="px-4 py-3 tabular-nums">{r.qty_planned ?? empty}</td>
                        <td className="px-4 py-3 tabular-nums">{r.qty_real ?? empty}</td>
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{r.output_lot ?? empty}</td>
                        <td className="px-4 py-3">{r.current_phase ?? empty}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.css}`}>{st.label}</span>
                        </td>
                        <td className="px-4 py-3 text-muted text-xs">{safeDate(r.created_at)}</td>
                        <td className="px-4 py-3 text-muted text-xs">{safeTime(r.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 1 && <StartForm loading={loading} onSubmit={start} onDone={() => setTab(0)} />}
      {tab === 2 && <ConfirmMaterialsForm loading={loading} onSubmit={confirm} />}
      {tab === 3 && <MaterialAdjustmentForm loading={loading} onSubmit={adjustMaterials} locations={locations} />}
      {tab === 4 && <AdvanceForm loading={loading} onSubmit={advance} />}
      {tab === 5 && <CloseForm loading={loading} onSubmit={close} locations={locations} />}
    </div>
  )
}

function StartForm({ loading, onSubmit, onDone }) {
  const [form, setForm] = useState({
    product_id: '',
    qty_planned: '',
    origin_type: 'STOCK_SEGURIDAD',
    customer_reference: '',
    final_customer: '',
    notes: '',
  })
  const [toast, setToast] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const handle = async (e) => {
    e.preventDefault()
    const res = await onSubmit({
      product_id: form.product_id.trim(),
      qty_planned: Number(form.qty_planned),
      origin_type: form.origin_type,
      customer_reference: form.customer_reference.trim() || undefined,
      final_customer: form.final_customer.trim() || undefined,
      notes: form.notes || undefined,
    })
    if (res.ok) {
      setToast({ msg: 'Orden iniciada', ok: true })
      setTimeout(() => { setToast(null); onDone() }, 1500)
    } else {
      setToast({ msg: res.message, ok: false })
    }
  }

  return (
    <form onSubmit={handle} className="max-w-md bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <Field label="ID del producto *"><input value={form.product_id} onChange={set('product_id')} placeholder="ID o SKU" className="input-field" required /></Field>
      <Field label="Cantidad planificada *"><input type="number" min="1" value={form.qty_planned} onChange={set('qty_planned')} placeholder="0" className="input-field" required /></Field>
      <Field label="Destino de la produccion *">
        <select value={form.origin_type} onChange={set('origin_type')} className="input-field">
          <option value="STOCK_SEGURIDAD">Stock de seguridad</option>
          <option value="OC_CLIENTE">Orden de cliente</option>
        </select>
      </Field>
      {form.origin_type === 'OC_CLIENTE' && (
        <>
          <Field label="Referencia OC cliente *"><input value={form.customer_reference} onChange={set('customer_reference')} className="input-field" required /></Field>
          <Field label="Cliente final *"><input value={form.final_customer} onChange={set('final_customer')} className="input-field" required /></Field>
        </>
      )}
      <Field label="Notas"><textarea value={form.notes} onChange={set('notes')} rows={2} className="input-field resize-none" /></Field>
      <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Liberando...' : 'Liberar orden'}</button>
    </form>
  )
}

function ConfirmMaterialsForm({ loading, onSubmit }) {
  const [orderId, setOrderId] = useState('')
  const [toast, setToast] = useState(null)
  const handle = async (event) => {
    event.preventDefault()
    const result = await onSubmit({ order_id: orderId.trim() })
    setToast(result.ok
      ? { msg: result.data?.already_confirmed ? 'Los materiales ya estaban confirmados' : 'Materiales confirmados; produccion iniciada', ok: true }
      : { msg: result.message, ok: false })
  }
  return (
    <form onSubmit={handle} className="max-w-md bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <Field label="Orden de produccion *">
        <input value={orderId} onChange={(event) => setOrderId(event.target.value)} placeholder="OP-..." className="input-field" required />
      </Field>
      <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Confirmando...' : 'Confirmar materiales e iniciar'}</button>
    </form>
  )
}

function MaterialAdjustmentForm({ loading, onSubmit, locations }) {
  const [form, setForm] = useState({ order_id: '', sku: '', lote: '', ubicacion_id: '', cantidad: '', tipo: 'ENTREGA_ADICIONAL', motivo: '' })
  const [toast, setToast] = useState(null)
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const handle = async (event) => {
    event.preventDefault()
    const result = await onSubmit({ ...form, ubicacion_id: Number(form.ubicacion_id), cantidad: Number(form.cantidad) })
    setToast(result.ok ? { msg: `${form.tipo} registrada`, ok: true } : { msg: result.message, ok: false })
  }
  return (
    <form onSubmit={handle} className="max-w-xl bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Orden *"><input value={form.order_id} onChange={set('order_id')} placeholder="OP-..." className="input-field" required /></Field>
        <Field label="Tipo *"><select value={form.tipo} onChange={set('tipo')} className="input-field"><option>ENTREGA_ADICIONAL</option><option>DEVOLUCION</option></select></Field>
        <Field label="SKU de materia prima *"><input value={form.sku} onChange={set('sku')} className="input-field" required /></Field>
        <Field label="Lote *"><input value={form.lote} onChange={set('lote')} className="input-field" required /></Field>
        <Field label="Ubicacion *"><select value={form.ubicacion_id} onChange={set('ubicacion_id')} className="input-field" required><option value="">Selecciona ubicacion</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.bodega_codigo} / {location.codigo}</option>)}</select></Field>
        <Field label="Cantidad *"><input type="number" min="0.0001" step="any" value={form.cantidad} onChange={set('cantidad')} className="input-field" required /></Field>
      </div>
      <Field label="Motivo"><input value={form.motivo} onChange={set('motivo')} className="input-field" /></Field>
      <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Registrando...' : 'Registrar movimiento'}</button>
    </form>
  )
}

function AdvanceForm({ loading, onSubmit }) {
  const [form, setForm] = useState({ order_id: '', phase: 'F1' })
  const [toast, setToast] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const handle = async (e) => {
    e.preventDefault()
    const res = await onSubmit({ order_id: form.order_id.trim(), phase: form.phase })
    if (res.ok) setToast({ msg: `Orden avanzada a ${form.phase}`, ok: true })
    else setToast({ msg: res.message, ok: false })
  }

  return (
    <form onSubmit={handle} className="max-w-md bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <Field label="ID de la orden *"><input value={form.order_id} onChange={set('order_id')} placeholder="ID u OP-..." className="input-field" required /></Field>
      <Field label="Fase destino *">
        <select value={form.phase} onChange={set('phase')} className="input-field">
          {PHASES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </Field>
      <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Avanzando...' : 'Avanzar fase'}</button>
    </form>
  )
}

function CloseForm({ loading, onSubmit, locations }) {
  const [form, setForm] = useState({ order_id: '', qty_real: '', qty_waste: '', waste_reason: '', ubicacion_id: '', expiry_date: '' })
  const [toast, setToast] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const handle = async (e) => {
    e.preventDefault()
    const qtyReal = Number(form.qty_real)
    const qtyWaste = Number(form.qty_waste)
    if (!Number.isFinite(qtyReal) || !Number.isFinite(qtyWaste)) {
      setToast({ msg: 'Confirma unidades conformes y merma', ok: false })
      return
    }
    if (qtyReal === 0 && qtyWaste === 0) {
      setToast({ msg: 'Debes contar y confirmar al menos unidades conformes o merma', ok: false })
      return
    }
    if (qtyWaste > 0 && !form.waste_reason.trim()) {
      setToast({ msg: 'Debes indicar el motivo de merma', ok: false })
      return
    }
    if (qtyReal > 0 && !form.ubicacion_id) {
      setToast({ msg: 'Selecciona la ubicacion del producto terminado', ok: false })
      return
    }

    const res = await onSubmit({
      order_id: form.order_id.trim(),
      qty_real: qtyReal,
      qty_waste: qtyWaste,
      waste_reason: form.waste_reason.trim() || undefined,
      ubicacion_id: form.ubicacion_id ? Number(form.ubicacion_id) : undefined,
      expiry_date: form.expiry_date || undefined,
    })
    if (res.ok) setToast({ msg: 'Orden cerrada exitosamente', ok: true })
    else setToast({ msg: res.message, ok: false })
  }

  return (
    <form onSubmit={handle} className="max-w-md bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <Field label="ID de la orden *"><input value={form.order_id} onChange={set('order_id')} placeholder="ID u OP-..." className="input-field" required /></Field>
      <Field label="Unidades conformes terminadas *"><input type="number" min="0" value={form.qty_real} onChange={set('qty_real')} placeholder="0" className="input-field" required /></Field>
      <Field label="Merma / no conforme *"><input type="number" min="0" value={form.qty_waste} onChange={set('qty_waste')} placeholder="0" className="input-field" required /></Field>
      <Field label="Ubicacion del producto terminado *">
        <select value={form.ubicacion_id} onChange={set('ubicacion_id')} className="input-field" required={Number(form.qty_real) > 0}>
          <option value="">Selecciona ubicacion</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.bodega_codigo} / {location.codigo}</option>)}
        </select>
      </Field>
      <Field label="Fecha de vencimiento"><input type="date" value={form.expiry_date} onChange={set('expiry_date')} className="input-field" /></Field>
      <Field label="Motivo de merma">
        <textarea value={form.waste_reason} onChange={set('waste_reason')} rows={2} placeholder="Obligatorio si la merma es mayor a 0" className="input-field resize-none" />
      </Field>
      <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Cerrando...' : 'Cerrar orden'}</button>
    </form>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted mb-1">{label}</label>
      {children}
    </div>
  )
}

function Alert({ msg }) {
  return <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">{msg}</div>
}

function ToastInline({ toast }) {
  return (
    <div className={`px-4 py-3 rounded-lg border text-sm ${
      toast.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'
    }`}>{toast.msg}</div>
  )
}

function EmptyState({ text }) {
  return <div className="flex flex-col items-center justify-center py-16 text-muted"><span className="text-4xl mb-3 opacity-30">#</span><p className="text-sm">{text}</p></div>
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
}
