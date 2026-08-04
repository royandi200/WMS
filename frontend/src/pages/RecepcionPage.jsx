import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useReceptionStore } from '../store/receptionStore'
import { createPurchaseOrder, listPurchaseOrders } from '../api/purchaseOrders.api'
import { confirmReception } from '../api/reception.api'
import { listUbicaciones } from '../api/inventory.api'
import { useAuthStore } from '../store/authStore'

const RECEPTION_TABS = [
  { key: 'orders', label: 'Ordenes de compra', capability: 'reception.create' },
  { key: 'confirm', label: 'Confirmar recepcion', capability: 'reception.confirm' },
  { key: 'history', label: 'Historico', capability: 'reception.read' },
]

export default function RecepcionPage() {
  const [tab, setTab] = useState('orders')
  const [toast, setToast] = useState(null)
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [purchaseLoading, setPurchaseLoading] = useState(false)
  const [locations, setLocations] = useState([])
  const { loading, list, fetchList } = useReceptionStore()
  const user = useAuthStore((state) => state.user)
  const capabilities = user?.capabilities || []
  const allowed = (capability) => capabilities.includes('*') || capabilities.includes(capability)
  const visibleTabs = RECEPTION_TABS.filter((item) => allowed(item.capability))

  useEffect(() => {
    if (!visibleTabs.some((item) => item.key === tab) && visibleTabs.length) setTab(visibleTabs[0].key)
  }, [tab, user?.rol])

  useEffect(() => {
    if (tab === 'orders' || tab === 'confirm') {
      setPurchaseLoading(true)
      listPurchaseOrders({ limit: 100 })
        .then((payload) => setPurchaseOrders(payload?.data?.rows || []))
        .catch((error) => showToast(error.response?.data?.error || 'Error al cargar ordenes de compra', false))
        .finally(() => setPurchaseLoading(false))
    }
    if (tab === 'confirm') {
      fetchList({ limit: 200 })
      listUbicaciones().then((payload) => setLocations(payload?.data?.rows || [])).catch(() => setLocations([]))
    }
    if (tab === 'history') fetchList({ limit: 100 })
  }, [tab])

  const showToast = (msg, ok) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  return (
    <div>
      <h1 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Recepciones</h1>

      <div className="flex gap-1 mb-4 md:mb-6 border-b border-border overflow-x-auto pb-px scrollbar-none">
        {visibleTabs.map((item) => (
          <button key={item.key} onClick={() => setTab(item.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === item.key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'
            }`}>{item.label}</button>
        ))}
      </div>

      {toast && (
        <div className={`mb-4 px-4 py-3 rounded-lg border text-sm ${
          toast.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'
        }`}>{toast.msg}</div>
      )}

      {tab === 'orders' && (
        <PurchaseOrdersPanel
          rows={purchaseOrders}
          loading={purchaseLoading}
          onCreate={async (body) => {
            setPurchaseLoading(true)
            try {
              const payload = await createPurchaseOrder(body)
              const refreshed = await listPurchaseOrders({ limit: 100 })
              setPurchaseOrders(refreshed?.data?.rows || [])
              showToast(`Orden ${payload?.data?.numero || body.numero} cargada`, true)
              return { ok: true }
            } catch (error) {
              const message = error.response?.data?.error || 'Error al cargar la orden de compra'
              showToast(message, false)
              return { ok: false, message }
            } finally {
              setPurchaseLoading(false)
            }
          }}
        />
      )}

      {tab === 'confirm' && (
        <ConfirmReceptionPanel
          rows={list.filter((row) => ['borrador', 'en_proceso'].includes(row.estado))}
          purchaseOrders={purchaseOrders}
          locations={locations}
          loading={loading || purchaseLoading}
          onConfirm={async (body) => {
            try {
              const payload = await confirmReception(body)
              showToast(`Recepcion ${payload?.data?.numero || ''} confirmada`, true)
              await fetchList({ limit: 200 })
              return { ok: true }
            } catch (error) {
              const message = error.response?.data?.error || 'Error al confirmar la recepcion'
              showToast(message, false)
              return { ok: false, message }
            }
          }}
        />
      )}

      {tab === 'history' && <ReceptionTable rows={list} loading={loading} />}
    </div>
  )
}

function ConfirmReceptionPanel({ rows, purchaseOrders, locations, loading, onConfirm }) {
  const grouped = Object.values(rows.reduce((result, row) => {
    if (!result[row.id]) result[row.id] = { ...row, items: [] }
    result[row.id].items.push(row)
    return result
  }, {}))
  const [receptionId, setReceptionId] = useState('')
  const [purchaseOrderId, setPurchaseOrderId] = useState('')
  const [items, setItems] = useState([])
  const selected = grouped.find((reception) => String(reception.id) === String(receptionId))

  const chooseReception = (value) => {
    setReceptionId(value)
    const reception = grouped.find((entry) => String(entry.id) === String(value))
    setItems((reception?.items || []).map((item) => ({
      item_id: item.recepcion_item_id,
      reception_item_id: item.recepcion_item_id,
      sku: item.sku,
      producto: item.producto_nombre,
      expected: Number(item.cantidad_esp || 0),
      distributions: [{ condicion: 'DISPONIBLE', cantidad: item.cantidad_esp || '', lote: '', ubicacion_id: '', fecha_venc: item.fecha_venc?.slice?.(0, 10) || '', motivo: '' }],
    })))
  }
  const setDistribution = (itemIndex, distributionIndex, key, value) => setItems((current) => current.map((item, index) => index !== itemIndex ? item : {
    ...item,
    distributions: item.distributions.map((distribution, indexDistribution) => indexDistribution === distributionIndex ? { ...distribution, [key]: value } : distribution),
  }))
  const addDistribution = (itemIndex) => setItems((current) => current.map((item, index) => index !== itemIndex ? item : {
    ...item,
    distributions: [...item.distributions, { condicion: 'CUARENTENA', cantidad: '', lote: '', ubicacion_id: '', fecha_venc: '', motivo: '' }],
  }))
  const removeDistribution = (itemIndex, distributionIndex) => setItems((current) => current.map((item, index) => index !== itemIndex ? item : {
    ...item,
    distributions: item.distributions.filter((_, indexDistribution) => indexDistribution !== distributionIndex),
  }))
  const submit = async (event) => {
    event.preventDefault()
    const body = {
      recepcion_id: Number(receptionId),
      orden_compra_id: Number(purchaseOrderId),
      items: items.map((item) => ({
        item_id: item.reception_item_id,
        qty_received: item.distributions.reduce((sum, distribution) => sum + Number(distribution.cantidad || 0), 0),
        distributions: item.distributions.map((distribution) => ({
          ...distribution,
          cantidad: Number(distribution.cantidad),
          ubicacion_id: distribution.ubicacion_id ? Number(distribution.ubicacion_id) : undefined,
          fecha_venc: distribution.fecha_venc || undefined,
          motivo: distribution.motivo || undefined,
        })),
      })),
    }
    const result = await onConfirm(body)
    if (result.ok) {
      setReceptionId('')
      setPurchaseOrderId('')
      setItems([])
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
        <Field label="Recepcion importada de Siigo *">
          <select value={receptionId} onChange={(event) => chooseReception(event.target.value)} className="input-field" required>
            <option value="">Selecciona una recepcion</option>
            {grouped.map((reception) => <option key={reception.id} value={reception.id}>{reception.numero} - {reception.proveedor_nombre}</option>)}
          </select>
        </Field>
        <Field label="Orden de compra *">
          <select value={purchaseOrderId} onChange={(event) => setPurchaseOrderId(event.target.value)} className="input-field" required>
            <option value="">Selecciona la OC</option>
            {purchaseOrders.filter((order) => !['CANCELADA', 'CERRADA'].includes(order.estado)).map((order) => <option key={order.id} value={order.id}>{order.numero} - {order.proveedor_nombre}</option>)}
          </select>
        </Field>
      </div>
      {selected && <p className="text-xs text-muted">Factura/compra Siigo: <span className="font-mono text-foreground">{selected.siigo_purchase_name || '-'}</span></p>}
      {items.map((item, itemIndex) => (
        <section key={item.item_id} className="border-y border-border py-4 space-y-3">
          <div><p className="text-sm font-medium text-foreground">{item.sku} - {item.producto}</p><p className="text-xs text-muted">Factura: {item.expected} unidades</p></div>
          {item.distributions.map((distribution, distributionIndex) => (
            <div key={distributionIndex} className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-[150px_110px_minmax(150px,1fr)_minmax(170px,1fr)_140px_36px] gap-2 items-end">
                <Field label="Condicion"><select value={distribution.condicion} onChange={(event) => setDistribution(itemIndex, distributionIndex, 'condicion', event.target.value)} className="input-field"><option>DISPONIBLE</option><option>CUARENTENA</option><option>RECHAZADO</option><option>PENDIENTE_DISPOSICION</option></select></Field>
                <Field label="Cantidad"><input type="number" min="0.0001" step="any" value={distribution.cantidad} onChange={(event) => setDistribution(itemIndex, distributionIndex, 'cantidad', event.target.value)} className="input-field" required /></Field>
                <Field label="Lote"><input value={distribution.lote} onChange={(event) => setDistribution(itemIndex, distributionIndex, 'lote', event.target.value)} className="input-field" required /></Field>
                <Field label="Ubicacion"><select value={distribution.ubicacion_id} onChange={(event) => setDistribution(itemIndex, distributionIndex, 'ubicacion_id', event.target.value)} className="input-field" required={['DISPONIBLE', 'CUARENTENA'].includes(distribution.condicion)}><option value="">Sin ubicacion</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.bodega_codigo} / {location.codigo}</option>)}</select></Field>
                <Field label="Vencimiento"><input type="date" value={distribution.fecha_venc} onChange={(event) => setDistribution(itemIndex, distributionIndex, 'fecha_venc', event.target.value)} className="input-field" /></Field>
                <button type="button" title="Eliminar distribucion" onClick={() => removeDistribution(itemIndex, distributionIndex)} disabled={item.distributions.length === 1} className="h-10 w-9 inline-flex items-center justify-center text-muted hover:text-danger disabled:opacity-30"><Trash2 size={16} /></button>
              </div>
              {distribution.condicion !== 'DISPONIBLE' && <Field label="Motivo *"><input value={distribution.motivo} onChange={(event) => setDistribution(itemIndex, distributionIndex, 'motivo', event.target.value)} className="input-field max-w-2xl" required /></Field>}
            </div>
          ))}
          <button type="button" onClick={() => addDistribution(itemIndex)} className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80"><Plus size={15} /> Otra ubicacion o condicion</button>
        </section>
      ))}
      {selected && <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Confirmando...' : 'Aprobar recepcion fisica'}</button>}
      {!loading && grouped.length === 0 && <div className="py-12 text-center text-sm text-muted">Sin recepciones pendientes</div>}
    </form>
  )
}

const EMPTY_PO = {
  numero: '',
  proveedor_nombre: '',
  fecha_orden: '',
  archivo_nombre: '',
  items: [{ sku: '', cantidad: '', unidad: 'und' }],
}

function PurchaseOrdersPanel({ rows, loading, onCreate }) {
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(EMPTY_PO)
  const setHeader = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const setItem = (index, key, value) => setForm((current) => ({
    ...current,
    items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
  }))
  const addItem = () => setForm((current) => ({
    ...current,
    items: [...current.items, { sku: '', cantidad: '', unidad: 'und' }],
  }))
  const removeItem = (index) => setForm((current) => ({
    ...current,
    items: current.items.filter((_, itemIndex) => itemIndex !== index),
  }))
  const submit = async (event) => {
    event.preventDefault()
    const result = await onCreate({
      ...form,
      fecha_orden: form.fecha_orden || undefined,
      archivo_nombre: form.archivo_nombre || undefined,
      items: form.items.map((item) => ({ ...item, cantidad: Number(item.cantidad) })),
    })
    if (result.ok) {
      setForm(EMPTY_PO)
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Ordenes esperadas</p>
          <p className="text-xs text-muted">No generan stock hasta confirmar la recepcion fisica.</p>
        </div>
        <button type="button" onClick={() => setCreating((value) => !value)} className="btn-primary inline-flex items-center gap-2">
          <Plus size={16} /> Nueva OC
        </button>
      </div>

      {creating && (
        <form onSubmit={submit} className="border-y border-border py-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Numero de OC *"><input value={form.numero} onChange={setHeader('numero')} className="input-field" required /></Field>
            <Field label="Proveedor *"><input value={form.proveedor_nombre} onChange={setHeader('proveedor_nombre')} className="input-field" required /></Field>
            <Field label="Fecha de orden"><input type="date" value={form.fecha_orden} onChange={setHeader('fecha_orden')} className="input-field" /></Field>
          </div>
          <Field label="Nombre del archivo origen">
            <input value={form.archivo_nombre} onChange={setHeader('archivo_nombre')} placeholder="OC-123.pdf o OC-123.xlsx" className="input-field" />
          </Field>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">Items</p>
            {form.items.map((item, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px_100px_36px] gap-2">
                <input value={item.sku} onChange={(event) => setItem(index, 'sku', event.target.value)} placeholder="SKU" className="input-field" required />
                <input type="number" min="0.0001" step="any" value={item.cantidad} onChange={(event) => setItem(index, 'cantidad', event.target.value)} placeholder="Cantidad" className="input-field" required />
                <input value={item.unidad} onChange={(event) => setItem(index, 'unidad', event.target.value)} placeholder="Unidad" className="input-field" />
                <button type="button" onClick={() => removeItem(index)} disabled={form.items.length === 1} title="Eliminar item" className="h-10 w-9 inline-flex items-center justify-center text-muted hover:text-danger disabled:opacity-30">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={addItem} className="px-3 py-2 border border-border text-sm text-foreground hover:bg-white/5 inline-flex items-center gap-2">
              <Plus size={15} /> Agregar item
            </button>
            <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Cargando...' : 'Cargar orden'}</button>
          </div>
        </form>
      )}

      <PurchaseOrderTable rows={rows} loading={loading} />
    </div>
  )
}

function PurchaseOrderTable({ rows, loading }) {
  const formatDate = (value) => value ? String(value).slice(0, 10) : '-'
  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full text-sm min-w-[760px]">
        <thead><tr className="bg-surface border-b border-border">
          {['Orden', 'Proveedor', 'Fecha OC', 'Estado', 'Items', 'Unidades', 'Cargada por', 'Creada'].map((label) => (
            <th key={label} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{label}</th>
          ))}
        </tr></thead>
        <tbody>
          {loading && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">Cargando ordenes...</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">Sin ordenes de compra cargadas</td></tr>}
          {!loading && rows.map((row) => (
            <tr key={row.id} className="border-b border-border/50 hover:bg-white/[0.02]">
              <td className="px-4 py-3 font-mono text-xs text-foreground">{row.numero}</td>
              <td className="px-4 py-3">{row.proveedor_nombre || '-'}</td>
              <td className="px-4 py-3 text-muted">{formatDate(row.fecha_orden)}</td>
              <td className="px-4 py-3"><span className="text-xs font-semibold text-sky-400">{row.estado}</span></td>
              <td className="px-4 py-3 tabular-nums">{row.total_items}</td>
              <td className="px-4 py-3 tabular-nums">{row.total_unidades}</td>
              <td className="px-4 py-3">{row.creado_por_nombre}</td>
              <td className="px-4 py-3 text-muted">{formatDate(row.creado_en)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
            {['Recepcion', 'OC', 'Factura Siigo', 'Fecha', 'Proveedor', 'SKU', 'Producto', 'Lote', 'OC / Factura / Fisico', 'Diferencias', 'Usuario'].map((c) => (
              <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted">Cargando recepciones...</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted">Sin recepciones registradas</td></tr>}
          {!loading && rows.map((r) => (
            <tr key={`${r.id}-${r.lote || ''}`} className="border-b border-border/50 hover:bg-white/[0.02]">
              <td className="px-4 py-3 font-mono text-xs">{r.numero}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.orden_compra_numero || '-'}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.siigo_purchase_name || '-'}</td>
              <td className="px-4 py-3 text-muted text-xs">{formatDate(r.completado_en || r.creado_en)}</td>
              <td className="px-4 py-3">{r.proveedor_nombre || '-'}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.sku || '-'}</td>
              <td className="px-4 py-3">{r.producto_nombre || '-'}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.lote || '-'}</td>
              <td className="px-4 py-3 tabular-nums text-xs">{r.cantidad_oc ?? '-'} / {r.cantidad_factura ?? r.cantidad_esp ?? '-'} / {r.cantidad_fisica ?? r.cantidad_rec ?? '-'}</td>
              <td className="px-4 py-3 tabular-nums text-xs"><span className={Number(r.diferencia_oc_factura) !== 0 ? 'text-yellow-400' : 'text-muted'}>OC-F: {r.diferencia_oc_factura ?? '-'}</span><span className={`block ${Number(r.diferencia_factura_fisica) !== 0 ? 'text-yellow-400' : 'text-muted'}`}>F-Fis: {r.diferencia_factura_fisica ?? '-'}</span></td>
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
