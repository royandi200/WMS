import { useEffect, useState } from 'react'
import { useDispatchStore } from '../store/dispatchStore'

const EMPTY = {
  lot_id: '',
  qty: '',
  customer: '',
  siigo_order_id: '',
  notes: '',
}

export default function DespachoPage() {
  const [tab, setTab] = useState(0)
  const [form, setForm] = useState(EMPTY)
  const [toast, setToast] = useState(null)
  const { loading, submit, list, fetchList } = useDispatchStore()

  useEffect(() => {
    if (tab === 1) fetchList({ limit: 100 })
  }, [tab])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const showToast = (msg, ok) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const body = {
      lot_id: form.lot_id.trim(),
      qty: Number(form.qty),
      customer: form.customer.trim(),
      siigo_order_id: form.siigo_order_id || undefined,
      notes: form.notes || undefined,
    }
    const res = await submit(body)
    if (res.ok) {
      showToast('Despacho registrado correctamente', true)
      setForm(EMPTY)
      await fetchList({ limit: 100 })
    } else {
      showToast(res.message, false)
    }
  }

  return (
    <div>
      <h1 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Despachos</h1>

      <div className="flex gap-1 mb-4 md:mb-6 border-b border-border overflow-x-auto pb-px scrollbar-none">
        {['Registrar', 'Historico'].map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === i ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {toast && (
        <div className={`mb-4 px-4 py-3 rounded-lg border text-sm ${
          toast.ok
            ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : 'bg-danger/10 border-danger/30 text-danger'
        }`}>
          {toast.msg}
        </div>
      )}

      {tab === 0 && (
        <form onSubmit={handleSubmit} className="max-w-xl bg-surface border border-border rounded-lg p-6 space-y-4">
          <Field label="Lote (LPN) *" required>
            <input
              value={form.lot_id}
              onChange={set('lot_id')}
              placeholder="Ej: TEST_AGENT-PTCG-DISP"
              className="input-field"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Cantidad *" required>
              <input
                type="number"
                min="1"
                value={form.qty}
                onChange={set('qty')}
                placeholder="0"
                className="input-field"
                required
              />
            </Field>
            <Field label="Nro Orden SIIGO">
              <input
                value={form.siigo_order_id}
                onChange={set('siigo_order_id')}
                placeholder="Ej: OV-2024-001"
                className="input-field"
              />
            </Field>
          </div>

          <Field label="Cliente *" required>
            <input
              value={form.customer}
              onChange={set('customer')}
              placeholder="Nombre del cliente"
              className="input-field"
              required
            />
          </Field>

          <Field label="Notas">
            <textarea
              value={form.notes}
              onChange={set('notes')}
              placeholder="Observaciones opcionales"
              rows={3}
              className="input-field resize-none"
            />
          </Field>

          <button type="submit" disabled={loading} className="btn-primary flex items-center justify-center gap-2">
            {loading ? <><Spin /> Registrando...</> : 'Registrar despacho'}
          </button>
        </form>
      )}

      {tab === 1 && <DispatchTable rows={list} loading={loading} />}
    </div>
  )
}

function DispatchTable({ rows, loading }) {
  const formatDate = (value) => value ? String(value).replace('T', ' ').slice(0, 16) : '-'

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[820px]">
        <thead>
          <tr className="bg-surface border-b border-border">
            {['Despacho', 'Fecha', 'Cliente', 'SKU', 'Producto', 'Lote', 'Cantidad', 'Usuario'].map((c) => (
              <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">Cargando despachos...</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">Sin despachos registrados</td></tr>
          )}
          {!loading && rows.map((r) => (
            <tr key={`${r.id}-${r.lote || ''}`} className="border-b border-border/50 hover:bg-white/[0.02]">
              <td className="px-4 py-3 font-mono text-xs text-foreground">{r.numero}</td>
              <td className="px-4 py-3 text-muted text-xs">{formatDate(r.despachado_en || r.creado_en)}</td>
              <td className="px-4 py-3">{r.cliente_nombre || '-'}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.sku || '-'}</td>
              <td className="px-4 py-3">{r.producto_nombre || '-'}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.lote || '-'}</td>
              <td className="px-4 py-3 tabular-nums">{r.cantidad ?? '-'}</td>
              <td className="px-4 py-3">{r.usuario_nombre || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted mb-1">
        {label}{required && <span className="text-primary ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function Spin() {
  return <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
}
