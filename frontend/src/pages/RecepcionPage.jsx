import { useState } from 'react'
import { useReceptionStore } from '../store/receptionStore'

const EMPTY = {
  product_id:  '',
  qty_total:   '',
  qty_damaged: '0',
  supplier:    '',
  expiry_date: '',
  notes:       '',
}

export default function RecepcionPage() {
  const [form, setForm]   = useState(EMPTY)
  const [toast, setToast] = useState(null)
  const { loading, submit } = useReceptionStore()

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const showToast = (msg, ok) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const body = {
      product_id:  form.product_id.trim(),
      qty_total:   Number(form.qty_total),
      qty_damaged: Number(form.qty_damaged),
      supplier:    form.supplier  || undefined,
      expiry_date: form.expiry_date || undefined,
      notes:       form.notes     || undefined,
    }
    const res = await submit(body)
    if (res.ok) {
      showToast('✓ Recepción registrada correctamente', true)
      setForm(EMPTY)
    } else {
      showToast(res.message, false)
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Registrar Recepción</h1>

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
        <Field label="ID del producto *" required>
          <input value={form.product_id} onChange={set('product_id')}
            placeholder="UUID del producto" className="input-field" required />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Cantidad total *" required>
            <input type="number" min="1" value={form.qty_total} onChange={set('qty_total')}
              placeholder="0" className="input-field" required />
          </Field>
          <Field label="Cantidad dañada">
            <input type="number" min="0" value={form.qty_damaged} onChange={set('qty_damaged')}
              placeholder="0" className="input-field" />
          </Field>
        </div>

        <Field label="Proveedor">
          <input value={form.supplier} onChange={set('supplier')}
            placeholder="Nombre del proveedor" className="input-field" />
        </Field>

        <Field label="Fecha de vencimiento">
          <input type="date" value={form.expiry_date} onChange={set('expiry_date')}
            className="input-field" />
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
            : 'Registrar recepción'}
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
