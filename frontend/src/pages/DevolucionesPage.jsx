import { useEffect, useState } from 'react'
import { createReturn, listReturns } from '../api/returns.api'
import { formatBogotaDateTime } from '../utils/dateTime'

const EMPTY = {
  despacho_id: '',
  referencia_devolucion: '',
  product_id: '',
  cantidad: '',
  cliente_origen: '',
  estado: 'CUARENTENA',
  lote_origen: '',
  observaciones: '',
  ubicacion: '',
}

const ESTADOS = [
  { value: 'RECUPERABLE', label: 'Recuperable', help: 'Suma al stock disponible' },
  { value: 'CUARENTENA', label: 'Cuarentena', help: 'Crea lote no disponible' },
]

export default function DevolucionesPage() {
  const [tab, setTab] = useState('crear')
  const [form, setForm] = useState(EMPTY)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)

  const fetchRows = async () => {
    setLoading(true)
    try {
      const res = await listReturns({ limit: 100 })
      setRows(res?.data?.rows || res?.rows || [])
      setError(null)
    } catch (e) {
      setError(e.response?.data?.error || 'Error al cargar devoluciones')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows() }, [])

  const set = (key) => (event) => {
    setConfirmDuplicate(false)
    setForm((current) => ({ ...current, [key]: event.target.value }))
  }

  const showToast = (msg, ok) => {
    setToast({ msg, ok })
    window.setTimeout(() => setToast(null), 4500)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload = {
        despacho_id: form.despacho_id.trim(),
        referencia_devolucion: form.referencia_devolucion.trim(),
        product_id: form.product_id.trim(),
        cantidad: Number(form.cantidad),
        cliente_origen: form.cliente_origen.trim(),
        estado: form.estado,
        lote_origen: form.lote_origen.trim(),
        ubicacion: form.ubicacion.trim() || undefined,
        observaciones: form.observaciones.trim() || undefined,
        confirmar_nueva_devolucion: Boolean(confirmDuplicate),
        id_devolucion_existente: confirmDuplicate || undefined,
      }
      const res = await createReturn(payload)
      const data = res?.data || res
      if (data.requires_confirmation) {
        setConfirmDuplicate(data.id || data.numero)
        showToast('Ya existe una devolucion igual reciente. Revisa los datos y vuelve a enviar solo si es un retorno nuevo.', false)
        return
      }
      showToast(data.already_completed
        ? `La devolucion ${data.numero || ''} ya estaba registrada. No se modifico inventario.`
        : `Devolucion ${data.numero || ''} registrada. ${data.destino || ''}`, true)
      setForm(EMPTY)
      setConfirmDuplicate(false)
      await fetchRows()
      setTab('historial')
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al registrar devolucion'
      showToast(msg, false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 md:mb-6">
        <div>
          <h1 className="text-lg md:text-xl font-semibold text-foreground">Devoluciones</h1>
          <p className="text-xs text-muted mt-1">Registra retornos, cuarentena y recuperacion de stock.</p>
        </div>
        <button
          onClick={fetchRows}
          disabled={loading}
          className="text-xs text-muted hover:text-foreground px-3 py-1.5 border border-border rounded transition-colors disabled:opacity-50"
        >
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto">
        {[
          ['crear', 'Registrar devolucion'],
          ['historial', `Historico (${rows.length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">{error}</div>}
      {toast && (
        <div className={`mb-4 px-4 py-3 rounded-lg border text-sm ${
          toast.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'
        }`}>
          {toast.msg}
        </div>
      )}

      {tab === 'crear' && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,640px)_minmax(320px,1fr)] gap-5">
          <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-lg p-5 space-y-4">
            <Field label="Factura o despacho origen *">
              <input
                value={form.despacho_id}
                onChange={set('despacho_id')}
                placeholder="Ej: FV-1-10000004804 o DSP-SIIGO-FV-1-10000004804"
                className="input-field"
                required
              />
            </Field>

            <Field label="Referencia externa (opcional)">
              <input
                value={form.referencia_devolucion}
                onChange={set('referencia_devolucion')}
                placeholder="Ej: RMA-CLIENTE-0001"
                className="input-field"
              />
            </Field>

            <Field label="SKU o ID del producto *">
              <input
                value={form.product_id}
                onChange={set('product_id')}
                placeholder="Ej: 00102-PTASH60"
                className="input-field"
                required
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Cantidad *">
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={form.cantidad}
                  onChange={set('cantidad')}
                  placeholder="0"
                  className="input-field"
                  required
                />
              </Field>
              <Field label="Estado *">
                <select value={form.estado} onChange={set('estado')} className="input-field">
                  {ESTADOS.map((estado) => <option key={estado.value} value={estado.value}>{estado.label}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Cliente origen">
              <input
                value={form.cliente_origen}
                onChange={set('cliente_origen')}
                placeholder="Ej: Cliente QA"
                className="input-field"
              />
            </Field>

            <Field label="Lote original despachado *">
              <input
                value={form.lote_origen}
                onChange={set('lote_origen')}
                placeholder="Ej: WMSQA260721LOT01"
                className="input-field"
                required
              />
            </Field>

            {form.estado === 'RECUPERABLE' && (
              <Field label="Ubicacion de reintegro *">
                <input
                  value={form.ubicacion}
                  onChange={set('ubicacion')}
                  placeholder="Ej: PPAL-A-1-01"
                  className="input-field"
                  required
                />
              </Field>
            )}

            <Field label="Observaciones">
              <textarea
                value={form.observaciones}
                onChange={set('observaciones')}
                rows={3}
                placeholder="Motivo, condicion del producto o decision de calidad"
                className="input-field resize-none"
              />
            </Field>

            <button type="submit" disabled={saving} className="btn-primary flex items-center justify-center gap-2">
              {saving ? <><Spin /> Registrando...</> : confirmDuplicate ? 'Registrar como devolucion nueva' : 'Registrar devolucion'}
            </button>
          </form>

          <div className="bg-surface border border-border rounded-lg p-5 h-fit">
            <h2 className="text-sm font-semibold text-foreground mb-3">Impacto en inventario</h2>
            <div className="space-y-3">
              {ESTADOS.map((estado) => (
                <div key={estado.value} className="flex items-start gap-3 pb-3 border-b border-border/50 last:border-b-0 last:pb-0">
                  <StatusBadge value={estado.value} />
                  <div>
                    <p className="text-xs font-medium text-foreground">{estado.label}</p>
                    <p className="text-xs text-muted mt-0.5">{estado.help}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted">
              Toda devolucion crea registro de recepcion y trazabilidad. Solo recuperable queda disponible para despacho.
            </p>
          </div>
        </div>
      )}

      {tab === 'historial' && <ReturnsTable rows={rows} loading={loading} />}
    </div>
  )
}

function ReturnsTable({ rows, loading }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[920px]">
        <thead>
          <tr className="bg-surface border-b border-border">
            {['Devolucion', 'Origen', 'Fecha', 'Cliente', 'SKU', 'Producto', 'Lotes', 'Ubicacion', 'Cantidad', 'Estado', 'Usuario'].map((c) => (
              <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted">Cargando devoluciones...</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted">Sin devoluciones registradas</td></tr>}
          {!loading && rows.map((r) => (
            <tr key={r.id} className="border-b border-border/50 hover:bg-white/[0.02]">
              <td className="px-4 py-3 font-mono text-xs">{r.numero}</td>
              <td className="px-4 py-3"><span className="block font-mono text-xs">{r.siigo_invoice_name || '-'}</span><span className="block text-xs text-muted">{r.referencia_externa || r.despacho_numero || ''}</span></td>
              <td className="px-4 py-3 text-muted text-xs">{formatDate(r.creado_en)}</td>
              <td className="px-4 py-3">{r.cliente_origen || '-'}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.sku || '-'}</td>
              <td className="px-4 py-3">{r.producto_nombre || '-'}</td>
              <td className="px-4 py-3"><span className="block font-mono text-xs">{r.lote || '-'}</span><span className="block text-xs text-muted">Origen: {r.lote_origen || '-'}</span></td>
              <td className="px-4 py-3 font-mono text-xs">{r.ubicacion || '-'}</td>
              <td className="px-4 py-3 tabular-nums">{r.cantidad ?? '-'}</td>
              <td className="px-4 py-3"><StatusBadge value={r.estado} /></td>
              <td className="px-4 py-3">{r.usuario_nombre || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function StatusBadge({ value }) {
  const status = String(value || '-').toUpperCase()
  const css = status === 'RECUPERABLE'
    ? 'text-green-400 bg-green-400/10'
    : status === 'CUARENTENA'
      ? 'text-yellow-400 bg-yellow-400/10'
      : 'text-danger bg-danger/10'
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${css}`}>{status}</span>
}

function Spin() {
  return <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
}

function formatDate(value) {
  return formatBogotaDateTime(value)
}
