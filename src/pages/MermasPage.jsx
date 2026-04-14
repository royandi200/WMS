import { useEffect, useState } from 'react'
import { useWasteStore } from '../store/wasteStore'

const TIPOS = [
  'MERMA_EN_MAQUINA',
  'MERMA_EN_ESTANTERIA',
  'MERMA_CIERRE_WIP',
  'RECHAZO_PROVEEDOR',
  'VENCIMIENTO',
  'AJUSTE_MANUAL',
]

const EMPTY = {
  type:                TIPOS[0],
  product_id:          '',
  qty:                 '',
  lot_id:              '',
  production_order_id: '',
  reason:              '',
}

const TABS = ['Registrar merma', 'Historial']

export default function MermasPage() {
  const [tab, setTab] = useState(0)
  const [form, setForm] = useState(EMPTY)
  const [toast, setToast] = useState(null)
  const { list, loading, error, submit, fetchList, clearError } = useWasteStore()

  useEffect(() => { if (tab === 1) fetchList() }, [tab])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const showToast = (msg, ok) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 4000) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const body = {
      type:       form.type,
      product_id: form.product_id.trim(),
      qty:        Number(form.qty),
      lot_id:              form.lot_id              || undefined,
      production_order_id: form.production_order_id || undefined,
      reason:              form.reason              || undefined,
    }
    const res = await submit(body)
    if (res.ok) { showToast('✓ Merma registrada correctamente', true); setForm(EMPTY) }
    else showToast(res.message, false)
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground mb-6">Mermas</h1>

      <div className="flex gap-1 mb-6 border-b border-border">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => { setTab(i); clearError() }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === i ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'
            }`}>{t}</button>
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

          <Field label="Tipo de merma *">
            <select value={form.type} onChange={set('type')} className="input-field">
              {TIPOS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>

          <Field label="ID del producto *">
            <input value={form.product_id} onChange={set('product_id')} placeholder="UUID del producto" className="input-field" required />
          </Field>

          <Field label="Cantidad *">
            <input type="number" min="0.001" step="0.001" value={form.qty} onChange={set('qty')} placeholder="0" className="input-field" required />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="ID del lote (si aplica)">
              <input value={form.lot_id} onChange={set('lot_id')} placeholder="UUID del lote" className="input-field" />
            </Field>
            <Field label="ID de orden producción">
              <input value={form.production_order_id} onChange={set('production_order_id')} placeholder="UUID de orden" className="input-field" />
            </Field>
          </div>

          <p className="text-xs text-muted">* Se requiere al menos un ID (lote u orden de producción)</p>

          <Field label="Motivo">
            <textarea value={form.reason} onChange={set('reason')} rows={3} placeholder="Descripción del motivo de la merma" className="input-field resize-none" />
          </Field>

          <button type="submit" disabled={loading} className="btn-primary flex items-center justify-center gap-2">
            {loading ? <><Spin /> Registrando...</> : 'Registrar merma'}
          </button>
        </form>
      )}

      {tab === 1 && (
        <div>
          {loading && <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}
          {!loading && list.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted">
              <span className="text-4xl mb-3 opacity-30">⚠</span>
              <p className="text-sm">Sin mermas registradas</p>
            </div>
          )}
          {list.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    {['Tipo','Producto','Cantidad','Lote','Motivo','Fecha'].map((c) => (
                      <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-white/[0.02]">
                      <td className="px-4 py-3"><span className="text-xs bg-danger/10 text-danger px-2 py-0.5 rounded-full">{r.type}</span></td>
                      <td className="px-4 py-3 font-mono text-xs text-muted">{r.product_id?.slice(0,8)}…</td>
                      <td className="px-4 py-3 tabular-nums text-danger font-semibold">{r.qty}</td>
                      <td className="px-4 py-3 text-muted text-xs">{r.lot_id?.slice(0,8) || '—'}</td>
                      <td className="px-4 py-3 text-muted max-w-xs truncate">{r.reason || '—'}</td>
                      <td className="px-4 py-3 text-muted text-xs">{r.created_at?.slice(0,10)}</td>
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
