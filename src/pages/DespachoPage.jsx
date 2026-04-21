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
  const [form, setForm] = useState(EMPTY)
  const [toast, setToast] = useState(null)

  const {
    list,
    loading,
    loadingList,
    submit,
    fetchList,
  } = useDispatchStore()

  useEffect(() => {
    fetchList()
  }, [])

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
      showToast('✓ Despacho registrado correctamente', true)
      setForm(EMPTY)
      fetchList()
    } else {
      showToast(res.message, false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold text-foreground mb-6">Registrar Despacho</h1>

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
            <input
              value={form.lot_id}
              onChange={set('lot_id')}
              placeholder="UUID del lote"
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

            <Field label="Nº Orden SIIGO">
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

          <button
            type="submit"
            disabled={loading}
            className="btn-primary flex items-center justify-center gap-2"
          >
            {loading ? <><Spin /> Registrando...</> : 'Registrar despacho'}
          </button>
        </form>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Histórico de Despachos</h2>
          <button
            onClick={() => fetchList()}
            disabled={loadingList}
            className="text-xs text-muted hover:text-foreground px-3 py-1.5 border border-border rounded transition-colors disabled:opacity-50"
          >
            {loadingList ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          {loadingList ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : list.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">
              No hay despachos registrados
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-background/40 border-b border-border">
                  <tr className="text-left text-muted">
                    <th className="px-4 py-3 font-medium">Número</th>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Lote</th>
                    <th className="px-4 py-3 font-medium">Cantidad</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((item, idx) => (
                    <tr key={item.id || item.numero || idx} className="border-b border-border/60 last:border-b-0">
                      <td className="px-4 py-3 text-foreground">{item.numero || '-'}</td>
                      <td className="px-4 py-3 text-foreground">{item.cliente_nombre || item.customer || '-'}</td>
                      <td className="px-4 py-3 text-foreground">{item.lote || '-'}</td>
                      <td className="px-4 py-3 text-foreground">{item.cantidad ?? '-'}</td>
                      <td className="px-4 py-3 text-foreground">{item.estado || '-'}</td>
                      <td className="px-4 py-3 text-muted">
                        {item.despachado_en || item.creado_en
                          ? String(item.despachado_en || item.creado_en).slice(0, 16).replace('T', ' ')
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
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
