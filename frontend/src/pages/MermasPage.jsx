import { useEffect, useState } from 'react'
import { formatBogotaDate } from '../utils/dateTime'
import { useWasteStore } from '../store/wasteStore'

const EMPTY = {
  type: 'BODEGA',
  external_reference: '',
  product_id: '',
  qty: '',
  lot_id: '',
  location: '',
  production_order_id: '',
  reason: '',
}

const TABS = ['Registrar merma', 'Historial']

export default function MermasPage() {
  const [tab, setTab] = useState(0)
  const [form, setForm] = useState(EMPTY)
  const [toast, setToast] = useState(null)
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)
  const { list, loading, error, submit, fetchList, clearError } = useWasteStore()

  useEffect(() => { if (tab === 1) fetchList() }, [tab])

  const set = (key) => (event) => {
    setConfirmDuplicate(false)
    setForm((current) => ({ ...current, [key]: event.target.value }))
  }
  const showToast = (msg, ok) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const body = {
      type: form.type,
      external_reference: form.external_reference.trim(),
      product_id: form.product_id.trim(),
      qty: Number(form.qty),
      lot_id: form.type === 'BODEGA' ? form.lot_id.trim() : undefined,
      location: form.type === 'BODEGA' ? form.location.trim() : undefined,
      production_order_id: form.type === 'PROCESO' ? form.production_order_id.trim() : undefined,
      reason: form.reason.trim(),
      confirmar_nueva_merma: Boolean(confirmDuplicate),
      id_merma_existente: confirmDuplicate || undefined,
    }
    const response = await submit(body)
    if (response.ok) {
      const result = response.data?.data || response.data
      if (result?.requires_confirmation) {
        setConfirmDuplicate(result.id || result.numero)
        showToast('Ya existe una merma igual reciente. Revisa los datos y vuelve a enviar solo si es una perdida nueva.', false)
        return
      }
      showToast(result?.already_completed
        ? 'La referencia ya estaba registrada; no se modificó inventario'
        : 'Merma registrada correctamente', true)
      setForm(EMPTY)
      setConfirmDuplicate(false)
    } else {
      showToast(response.message, false)
    }
  }

  return (
    <div>
      <h1 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Mermas</h1>

      <div className="flex gap-1 mb-4 md:mb-6 border-b border-border overflow-x-auto pb-px scrollbar-none">
        {TABS.map((label, index) => (
          <button key={label} onClick={() => { setTab(index); clearError() }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === index ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'
            }`}>{label}</button>
        ))}
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">{error}</div>}

      {tab === 0 && (
        <form onSubmit={handleSubmit} className="max-w-xl bg-surface border border-border rounded-lg p-6 space-y-4">
          {toast && (
            <div className={`px-4 py-3 rounded-lg border text-sm ${
              toast.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'
            }`}>{toast.msg}</div>
          )}

          <Field label="Origen de la merma *">
            <select value={form.type} onChange={set('type')} className="input-field">
              <option value="BODEGA">Almacenamiento / bodega</option>
              <option value="PROCESO">Producción en proceso</option>
            </select>
          </Field>

          <Field label="Referencia externa (opcional)">
            <input value={form.external_reference} onChange={set('external_reference')}
              placeholder="Ej. formato o acta del cliente" maxLength={80} className="input-field" />
          </Field>

          <Field label="SKU del producto *">
            <input value={form.product_id} onChange={set('product_id')}
              placeholder="Ej. 00102-PTASH60" className="input-field" required />
          </Field>

          <Field label="Cantidad *">
            <input type="number" min="0.001" step="0.001" value={form.qty} onChange={set('qty')}
              placeholder="0" className="input-field" required />
          </Field>

          {form.type === 'BODEGA' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Lote *">
                <input value={form.lot_id} onChange={set('lot_id')}
                  placeholder="Código visible del lote" className="input-field" required />
              </Field>
              <Field label="Ubicación *">
                <input value={form.location} onChange={set('location')}
                  placeholder="Ej. PPAL-A-1-01" className="input-field" required />
              </Field>
            </div>
          ) : (
            <Field label="Orden de producción *">
              <input value={form.production_order_id} onChange={set('production_order_id')}
                placeholder="Ej. OP-20260805-000061" className="input-field" required />
            </Field>
          )}

          <Field label="Motivo *">
            <textarea value={form.reason} onChange={set('reason')} rows={3} maxLength={255}
              placeholder="Describe la causa de la merma" className="input-field resize-none" required />
          </Field>

          <button type="submit" disabled={loading} className="btn-primary flex items-center justify-center gap-2">
            {loading ? <><Spin /> Registrando...</> : confirmDuplicate ? 'Registrar como merma nueva' : 'Registrar merma'}
          </button>
        </form>
      )}

      {tab === 1 && (
        <div>
          {loading && <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}
          {!loading && list.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted">
              <span className="text-4xl mb-3 opacity-30">!</span>
              <p className="text-sm">Sin mermas registradas</p>
            </div>
          )}
          {list.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    {['Referencia', 'Tipo', 'Producto', 'Cantidad', 'Lote / orden', 'Ubicación', 'Motivo', 'Fecha'].map((column) => (
                      <th key={column} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-xs">{row.external_reference || row.numero}</td>
                      <td className="px-4 py-3"><span className="text-xs bg-danger/10 text-danger px-2 py-0.5 rounded-full">{row.type}</span></td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs text-foreground">{row.sku || String(row.product_id || '').slice(0, 12)}</div>
                        {row.product_name && <div className="text-xs text-muted truncate max-w-[220px]">{row.product_name}</div>}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-danger font-semibold">{row.qty}</td>
                      <td className="px-4 py-3 text-muted text-xs">{row.lot_id || row.production_order_code || '-'}</td>
                      <td className="px-4 py-3 text-muted text-xs">{row.location_code || '-'}</td>
                      <td className="px-4 py-3 text-muted max-w-xs truncate">{row.reason || '-'}</td>
                      <td className="px-4 py-3 text-muted text-xs">{formatBogotaDate(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return <div><label className="block text-xs font-medium text-muted mb-1">{label}</label>{children}</div>
}

function Spin() {
  return <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
}
