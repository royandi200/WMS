import { useEffect, useState } from 'react'
import { useProductionStore } from '../store/productionStore'

const PHASES = ['F1','F2','F3','F4','F5']
const STATUS_LABEL = {
  PLANEADA:   { label: 'Planeada',   css: 'text-yellow-400 bg-yellow-400/10' },
  APROBADA:   { label: 'Aprobada',   css: 'text-blue-400   bg-blue-400/10'   },
  EN_PROCESO: { label: 'En proceso', css: 'text-indigo-400 bg-indigo-400/10' },
  CERRADA:    { label: 'Cerrada',    css: 'text-green-400  bg-green-400/10'  },
  CANCELADA:  { label: 'Cancelada',  css: 'text-muted      bg-white/5'       },
}
const TABS = ['Listado', 'Nueva orden', 'Avanzar fase', 'Cerrar orden']

export default function ProduccionPage() {
  const [tab, setTab] = useState(0)
  const { list, loading, error, fetchList, start, advance, close, clearError } = useProductionStore()

  useEffect(() => { if (tab === 0) fetchList() }, [tab])

  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground mb-6">Producción</h1>

      <div className="flex gap-1 mb-6 border-b border-border">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => { setTab(i); clearError() }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === i ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'
            }`}>{t}</button>
        ))}
      </div>

      {error && <Alert msg={error} />}

      {tab === 0 && (
        <div>
          {loading && <Spinner />}
          {!loading && list.length === 0 && <EmptyState icon="⚙" text="Sin órdenes de producción" />}
          {list.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    {['Código orden','Producto','SKU','Cant. plan.','Cant. real','Fase','Estado','Creado'].map((c) => (
                      <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const st = STATUS_LABEL[r.status] || { label: r.status, css: 'text-muted bg-white/5' }
                    return (
                      <tr key={r.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{r.codigo_orden ?? r.id}</td>
                        <td className="px-4 py-3 text-foreground">{r.product_name ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted">{r.sku ?? '—'}</td>
                        <td className="px-4 py-3 tabular-nums">{r.qty_planned ?? '—'}</td>
                        <td className="px-4 py-3 tabular-nums">{r.qty_real ?? '—'}</td>
                        <td className="px-4 py-3">{r.current_phase ?? 'F0'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.css}`}>{st.label}</span>
                        </td>
                        <td className="px-4 py-3 text-muted text-xs">{r.created_at?.slice(0,10) ?? '—'}</td>
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
      {tab === 2 && <AdvanceForm loading={loading} onSubmit={advance} />}
      {tab === 3 && <CloseForm loading={loading} onSubmit={close} />}
    </div>
  )
}

function StartForm({ loading, onSubmit, onDone }) {
  const [form, setForm] = useState({ product_id: '', qty_planned: '', notes: '' })
  const [toast, setToast] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const handle = async (e) => {
    e.preventDefault()
    const res = await onSubmit({ product_id: form.product_id.trim(), qty_planned: Number(form.qty_planned), notes: form.notes || undefined })
    if (res.ok) { setToast({ msg: '✓ Orden iniciada', ok: true }); setTimeout(() => { setToast(null); onDone() }, 1500) }
    else setToast({ msg: res.message, ok: false })
  }
  return (
    <form onSubmit={handle} className="max-w-md bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <Field label="ID del producto *"><input value={form.product_id} onChange={set('product_id')} placeholder="UUID" className="input-field" required /></Field>
      <Field label="Cantidad planificada *"><input type="number" min="1" value={form.qty_planned} onChange={set('qty_planned')} placeholder="0" className="input-field" required /></Field>
      <Field label="Notas"><textarea value={form.notes} onChange={set('notes')} rows={2} className="input-field resize-none" /></Field>
      <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Iniciando...' : 'Iniciar orden'}</button>
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
    if (res.ok) setToast({ msg: `✓ Orden avanzada a ${form.phase}`, ok: true })
    else setToast({ msg: res.message, ok: false })
  }
  return (
    <form onSubmit={handle} className="max-w-md bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <Field label="ID de la orden *"><input value={form.order_id} onChange={set('order_id')} placeholder="UUID" className="input-field" required /></Field>
      <Field label="Fase destino *">
        <select value={form.phase} onChange={set('phase')} className="input-field">
          {PHASES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </Field>
      <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Avanzando...' : 'Avanzar fase'}</button>
    </form>
  )
}

function CloseForm({ loading, onSubmit }) {
  const [form, setForm] = useState({ order_id: '', qty_real: '' })
  const [toast, setToast] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const handle = async (e) => {
    e.preventDefault()
    const res = await onSubmit({ order_id: form.order_id.trim(), qty_real: Number(form.qty_real) })
    if (res.ok) setToast({ msg: '✓ Orden cerrada exitosamente', ok: true })
    else setToast({ msg: res.message, ok: false })
  }
  return (
    <form onSubmit={handle} className="max-w-md bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <Field label="ID de la orden *"><input value={form.order_id} onChange={set('order_id')} placeholder="UUID" className="input-field" required /></Field>
      <Field label="Cantidad real producida *"><input type="number" min="0" value={form.qty_real} onChange={set('qty_real')} placeholder="0" className="input-field" required /></Field>
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
function EmptyState({ icon, text }) {
  return <div className="flex flex-col items-center justify-center py-16 text-muted"><span className="text-4xl mb-3 opacity-30">{icon}</span><p className="text-sm">{text}</p></div>
}
function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
}
