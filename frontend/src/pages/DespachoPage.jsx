import { useState } from 'react'
import { useDispatchStore } from '../store/dispatchStore'

const EMPTY = {
  lot_id:         '',
  qty:            '',
  customer:       '',
  siigo_order_id: '',
  notes:          '',
}

export default function DespachoPage() {
  const [form, setForm]   = useState(EMPTY)
  const [toast, setToast] = useState(null)
  const { loading, submit } = useDispatchStore()

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const showToast = (msg, ok) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const body = {
      lot_id:         form.lot_id.trim(),
      qty:            Number(form.qty),
      customer:       form.customer.trim(),
      siigo_order_id: form.siigo_order_id || undefined,
      notes:          form.notes          || undefined,
    }
    const res = await submit(body)
    if (res.ok) {
      showToast('✓ Despacho registrado correctamente', true)
      setForm(EMPTY)
    } else {
      showToast(res.message, false)
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Registrar Despacho</h1>

      {toast && (
        <div className={`mb-4 px-4 py-3 rounded-lg border text-sm ${
          toast.ok
            ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : 'bg-danger/10 border-danger/30 text-danger'
        }`}>
          {toast.msg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-lg p-6 space-y-4">
        <Field label="ID del lote (LPN) *" required>
          <input value={form.lot_id} onChange={set('lot_id')}
            placeholder="UUID del lote" className="input-field" required />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Cantidad *" required>
            <input type="number" min="1" value={form.qty} onChange={set('qty')}
              placeholder="0" className="input-field" required />
          </Field>
          <Field label="Nº Orden SIIGO">
            <input value={form.siigo_order_id} onChange={set('siigo_order_id')}
              placeholder="Ej: OV-2024-001" className="input-field" />
          </Field>
        </div>

        <Field label="Cliente *" required>
          <input value={form.customer} onChange={set('customer')}
            placeholder="Nombre del cliente" className="input-field" required />
        </Field>

        <Field label="Notas">
          <textarea value={form.notes} onChange={set('notes')}
            placeholder="Observaciones opcionales" rows={3}
            className="input-field resize-none" />
        </Field>

        <button type="submit" disabled={loading}
          className="btn-primary flex items-center justify-center gap-2">
          {loading
            ? <><Spin /> Registrando...</>
            : 'Registrar despacho'}
        </button>
      </form>
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
