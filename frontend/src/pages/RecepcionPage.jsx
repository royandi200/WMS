import { useEffect, useState } from 'react'
import { useReceptionStore } from '../store/receptionStore'

const EMPTY = {
  product_id: '',
  qty_total: '',
  qty_damaged: '0',
  supplier: '',
  expiry_date: '',
  notes: '',
}

export default function RecepcionPage() {
  const [tab, setTab] = useState(0)
  const [form, setForm] = useState(EMPTY)
  const [toast, setToast] = useState(null)
  const { loading, submit, list, fetchList } = useReceptionStore()

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
      product_id: form.product_id.trim(),
      qty_total: Number(form.qty_total),
      qty_damaged: Number(form.qty_damaged),
      supplier: form.supplier || undefined,
      expiry_date: form.expiry_date || undefined,
      notes: form.notes || undefined,
    }
    const res = await submit(body)
    if (res.ok) {
      showToast('Recepcion registrada correctamente', true)
      setForm(EMPTY)
      await fetchList({ limit: 100 })
    } else {
      showToast(res.message, false)
    }
  }

  return (
    <div>
      <h1 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Recepciones</h1>

      <div className="flex gap-1 mb-4 md:mb-6 border-b border-border overflow-x-auto pb-px scrollbar-none">
        {['Registrar', 'Historico'].map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === i ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'
            }`}>{t}</button>
        ))}
      </div>

      {toast && (
        <div className={`mb-4 px-4 py-3 rounded-lg border text-sm ${
          toast.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'
        }`}>{toast.msg}</div>
      )}

      {tab === 0 && (
        <form onSubmit={handleSubmit} className="max-w-xl bg-surface border border-border rounded-lg p-6 space-y-4">
          <Field label="ID o SKU del producto *" required>
            <input value={form.product_id} onChange={set('product_id')} placeholder="Ej: 00051-MPASH" className="input-field" required />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Cantidad total *" required>
              <input type="number" min="1" value={form.qty_total} onChange={set('qty_total')} placeholder="0" className="input-field" required />
            </Field>
            <Field label="Cantidad danada">
              <input type="number" min="0" value={form.qty_damaged} onChange={set('qty_damaged')} placeholder="0" className="input-field" />
            </Field>
          </div>

          <Field label="Proveedor">
            <input value={form.supplier} onChange={set('supplier')} placeholder="Nombre del proveedor" className="input-field" />
          </Field>

          <Field label="Fecha de vencimiento">
            <input type="date" value={form.expiry_date} onChange={set('expiry_date')} className="input-field" />
          </Field>

          <Field label="Notas">
            <textarea value={form.notes} onChange={set('notes')} placeholder="Observaciones opcionales" rows={3} className="input-field resize-none" />
          </Field>

          <button type="submit" disabled={loading} className="btn-primary flex items-center justify-center gap-2">
            {loading ? <><Spin /> Registrando...</> : 'Registrar recepcion'}
          </button>
        </form>
      )}

      {tab === 1 && <ReceptionTable rows={list} loading={loading} />}
    </div>
  )
}

function ReceptionTable({ rows, loading }) {
  const formatDate = (value) => value ? String(value).replace('T', ' ').slice(0, 16) : '-'
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[860px]">
        <thead>
          <tr className="bg-surface border-b border-border">
            {['Recepcion', 'Fecha', 'Proveedor', 'SKU', 'Producto', 'Lote', 'Esperado', 'Recibido', 'Usuario'].map((c) => (
              <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">Cargando recepciones...</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">Sin recepciones registradas</td></tr>}
          {!loading && rows.map((r) => (
            <tr key={`${r.id}-${r.lote || ''}`} className="border-b border-border/50 hover:bg-white/[0.02]">
              <td className="px-4 py-3 font-mono text-xs">{r.numero}</td>
              <td className="px-4 py-3 text-muted text-xs">{formatDate(r.completado_en || r.creado_en)}</td>
              <td className="px-4 py-3">{r.proveedor_nombre || '-'}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.sku || '-'}</td>
              <td className="px-4 py-3">{r.producto_nombre || '-'}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.lote || '-'}</td>
              <td className="px-4 py-3 tabular-nums">{r.cantidad_esp ?? '-'}</td>
              <td className="px-4 py-3 tabular-nums">{r.cantidad_rec ?? '-'}</td>
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
