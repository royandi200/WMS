import { useEffect, useState } from 'react'
import { Ban, Download, FileText, Plus, Trash2, X } from 'lucide-react'
import { useReceptionStore } from '../store/receptionStore'
import { cancelPurchaseOrder, createPurchaseOrder, downloadPurchaseOrderDocument, listPurchaseOrders } from '../api/purchaseOrders.api'
import { listOutsourcingOrders } from '../api/outsourcing.api'
import { listSuppliers } from '../api/suppliers.api'
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
  const [outsourcingOrders, setOutsourcingOrders] = useState([])
  const [suppliers, setSuppliers] = useState([])
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
    if (tab === 'orders') {
      listSuppliers()
        .then((payload) => setSuppliers(payload?.data?.rows || []))
        .catch((error) => showToast(error.response?.data?.error || 'Error al cargar proveedores', false))
    }
    if (tab === 'confirm') {
      fetchList({ limit: 200 })
      listUbicaciones().then((payload) => setLocations(payload?.data?.rows || [])).catch(() => setLocations([]))
      listOutsourcingOrders({ limit: 200 })
        .then((payload) => setOutsourcingOrders(payload?.data?.rows || []))
        .catch(() => setOutsourcingOrders([]))
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
          suppliers={suppliers}
          loading={purchaseLoading}
          canCancel={allowed('purchase_order.cancel')}
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
          onCancel={async (id, motivo) => {
            setPurchaseLoading(true)
            try {
              const payload = await cancelPurchaseOrder(id, motivo)
              const refreshed = await listPurchaseOrders({ limit: 100 })
              setPurchaseOrders(refreshed?.data?.rows || [])
              const duplicate = payload?.data?.duplicate
              showToast(duplicate ? 'La orden ya estaba cancelada' : `Orden ${payload?.data?.numero || ''} cancelada`, true)
              return { ok: true }
            } catch (error) {
              const message = error.response?.data?.error || 'Error al cancelar la orden de compra'
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
          outsourcingOrders={outsourcingOrders}
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

function ConfirmReceptionPanel({ rows, purchaseOrders, locations, outsourcingOrders, loading, onConfirm }) {
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
      modalidad: item.modalidad_operativa,
      expected: Number(item.cantidad_esp || 0),
      orden_maquila_id: '',
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
        orden_maquila_id: item.orden_maquila_id ? Number(item.orden_maquila_id) : undefined,
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
          {item.modalidad === 'PT' && (
            <Field label="Orden de maquila 3Q *">
              <select
                value={item.orden_maquila_id}
                onChange={(event) => {
                  const value = event.target.value
                  const order = outsourcingOrders.find((entry) => String(entry.id) === String(value))
                  setItems((current) => current.map((entry, index) => index === itemIndex ? { ...entry, orden_maquila_id: value } : entry))
                  if (order?.orden_compra_id) setPurchaseOrderId(String(order.orden_compra_id))
                }}
                className="input-field max-w-xl"
                required
              >
                <option value="">Selecciona la orden correspondiente</option>
                {outsourcingOrders
                  .filter((order) => order.sku === item.sku && ['EN_3Q', 'RECIBIDA_PARCIAL'].includes(order.estado))
                  .map((order) => <option key={order.id} value={order.id}>{order.codigo} - pendiente {Math.max(Number(order.cantidad_objetivo) - Number(order.cantidad_recibida), 0)}</option>)}
              </select>
            </Field>
          )}
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
  tercero_id: '',
  fecha_orden: '',
  documento_pdf: null,
  items: [{ sku: '', cantidad: '', unidad: 'und' }],
}

function PurchaseOrdersPanel({ rows, suppliers, loading, canCancel, onCreate, onCancel }) {
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(EMPTY_PO)
  const [formError, setFormError] = useState('')
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
    setFormError('')
    if (!form.documento_pdf) {
      setFormError('Debes seleccionar la orden de compra en PDF.')
      return
    }
    try {
      const base64 = await readFileAsDataUrl(form.documento_pdf)
      const result = await onCreate({
        ...form,
        tercero_id: Number(form.tercero_id),
        fecha_orden: form.fecha_orden || undefined,
        archivo_nombre: form.documento_pdf.name,
        documento_pdf: {
          nombre: form.documento_pdf.name,
          mime_type: form.documento_pdf.type || 'application/pdf',
          base64,
        },
        items: form.items.map((item) => ({
          ...item,
          sku: item.sku.trim(),
          unidad: item.unidad.trim(),
          cantidad: Number(item.cantidad),
        })),
      })
      if (result.ok) {
        setForm(EMPTY_PO)
        setCreating(false)
      } else {
        setFormError(result.message || 'No fue posible cargar la orden de compra.')
      }
    } catch (error) {
      setFormError(error.message || 'No fue posible leer el PDF seleccionado.')
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
            <Field label="Proveedor sincronizado *">
              <select value={form.tercero_id} onChange={setHeader('tercero_id')} className="input-field" required>
                <option value="">Seleccionar proveedor</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.nombre}{supplier.identification ? ` - ${supplier.identification}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fecha de orden"><input type="date" value={form.fecha_orden} onChange={setHeader('fecha_orden')} className="input-field" /></Field>
          </div>
          <Field label="Orden de compra en PDF *">
            <label className="flex min-h-20 cursor-pointer items-center gap-3 border border-dashed border-border px-4 py-3 hover:border-primary/60">
              <FileText size={20} className="text-primary" />
              <span className="min-w-0 flex-1 text-sm text-foreground">
                {form.documento_pdf ? form.documento_pdf.name : 'Seleccionar PDF'}
                <span className="block text-xs text-muted">Maximo 2.5 MB. Los items se transcriben para permitir la conciliacion.</span>
              </span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                required
                onChange={(event) => {
                  const file = event.target.files?.[0] || null
                  if (file && file.size > 2_500_000) {
                    event.target.value = ''
                    setForm((current) => ({ ...current, documento_pdf: null }))
                    return
                  }
                  setForm((current) => ({ ...current, documento_pdf: file }))
                }}
              />
            </label>
          </Field>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">Items</p>
            {form.items.map((item, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px_100px_36px] gap-2">
                <input value={item.sku} onChange={(event) => setItem(index, 'sku', event.target.value)} placeholder="SKU" pattern="[A-Za-z0-9._&amp;-]+" title="Usa solo letras, numeros, punto, guion, guion bajo o &amp;" className="input-field" required />
                <input type="number" min="0.0001" step="any" value={item.cantidad} onChange={(event) => setItem(index, 'cantidad', event.target.value)} placeholder="Cantidad" className="input-field" required />
                <input value={item.unidad} onChange={(event) => setItem(index, 'unidad', event.target.value)} placeholder="Unidad" className="input-field" />
                <button type="button" onClick={() => removeItem(index)} disabled={form.items.length === 1} title="Eliminar item" className="h-10 w-9 inline-flex items-center justify-center text-muted hover:text-danger disabled:opacity-30">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          {formError && (
            <div role="alert" className="border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {formError}
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={addItem} className="px-3 py-2 border border-border text-sm text-foreground hover:bg-white/5 inline-flex items-center gap-2">
              <Plus size={15} /> Agregar item
            </button>
            <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Cargando...' : 'Cargar orden'}</button>
          </div>
        </form>
      )}

      <PurchaseOrderTable rows={rows} loading={loading} canCancel={canCancel} onCancel={onCancel} />
    </div>
  )
}

function PurchaseOrderTable({ rows, loading, canCancel, onCancel }) {
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const formatDate = (value) => value ? String(value).replace('T', ' ').slice(0, 16) : '-'
  const closeCancel = () => {
    setCancelTarget(null)
    setCancelReason('')
    setConfirmed(false)
    setCancelError('')
  }
  const submitCancellation = async (event) => {
    event.preventDefault()
    setCancelError('')
    if (cancelReason.trim().length < 5) {
      setCancelError('Escribe un motivo de al menos 5 caracteres.')
      return
    }
    if (!confirmed) {
      setCancelError('Confirma que deseas cancelar esta orden.')
      return
    }
    setSubmitting(true)
    const result = await onCancel(cancelTarget.id, cancelReason.trim())
    setSubmitting(false)
    if (result.ok) closeCancel()
    else setCancelError(result.message)
  }
  const statusClass = (status) => status === 'CANCELADA'
    ? 'text-danger'
    : ['RECIBIDA', 'CERRADA'].includes(status) ? 'text-green-400' : 'text-sky-400'
  return (
    <>
      <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full text-sm min-w-[960px]">
        <thead><tr className="bg-surface border-b border-border">
          {['Orden', 'PDF', 'Proveedor', 'Fecha OC', 'Estado', 'Items', 'Unidades', 'Cargada por', 'Creada', 'Acciones'].map((label) => (
            <th key={label} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{label}</th>
          ))}
        </tr></thead>
        <tbody>
          {loading && <tr><td colSpan={10} className="px-4 py-10 text-center text-muted">Cargando ordenes...</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-muted">Sin ordenes de compra cargadas</td></tr>}
          {!loading && rows.map((row) => (
            <tr key={row.id} className="border-b border-border/50 hover:bg-white/[0.02]">
              <td className="px-4 py-3 font-mono text-xs text-foreground">{row.numero}</td>
              <td className="px-4 py-3">
                {row.documento_id ? (
                  <button type="button" title="Descargar PDF" onClick={() => downloadPurchaseOrderDocument(row.documento_id, row.documento_nombre)} className="inline-flex h-8 w-8 items-center justify-center text-primary hover:bg-primary/10">
                    <Download size={16} />
                  </button>
                ) : <span className="text-xs text-danger">Falta</span>}
              </td>
              <td className="px-4 py-3">{row.proveedor_nombre || '-'}</td>
              <td className="px-4 py-3 text-muted">{formatDate(row.fecha_orden).slice(0, 10)}</td>
              <td className="px-4 py-3 max-w-64">
                <span className={`text-xs font-semibold ${statusClass(row.estado)}`}>{row.estado}</span>
                {row.estado === 'CANCELADA' && (
                  <span className="block mt-1 text-xs text-muted">
                    {row.motivo_cancelacion}<br />
                    {row.cancelada_por_nombre || 'Usuario'} · {formatDate(row.cancelada_en)}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 tabular-nums">{row.total_items}</td>
              <td className="px-4 py-3 tabular-nums">{row.total_unidades}</td>
              <td className="px-4 py-3">{row.creado_por_nombre}</td>
              <td className="px-4 py-3 text-muted">{formatDate(row.creado_en)}</td>
              <td className="px-4 py-3">
                {canCancel && row.estado === 'CARGADA' ? (
                  <button
                    type="button"
                    title="Cancelar orden de compra"
                    aria-label={`Cancelar orden ${row.numero}`}
                    onClick={() => setCancelTarget(row)}
                    className="inline-flex h-8 w-8 items-center justify-center text-muted hover:bg-danger/10 hover:text-danger"
                  >
                    <Ban size={16} />
                  </button>
                ) : <span className="text-muted">-</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="cancel-po-title">
          <form onSubmit={submitCancellation} className="w-full max-w-lg border border-border bg-surface shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 id="cancel-po-title" className="text-base font-semibold text-foreground">Cancelar {cancelTarget.numero}</h2>
                <p className="mt-1 text-sm text-muted">La orden dejara de estar disponible para recepcion o procesos 3Q. El PDF y su historial se conservaran.</p>
              </div>
              <button type="button" onClick={closeCancel} title="Cerrar" className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted hover:text-foreground">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <Field label="Motivo de cancelacion *">
                <textarea
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  maxLength={500}
                  rows={4}
                  className="input-field resize-y"
                  placeholder="Ej. Orden duplicada o anulada por el proveedor"
                  autoFocus
                  required
                />
              </Field>
              <label className="flex cursor-pointer items-start gap-3 text-sm text-foreground">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-500" />
                <span>Confirmo que esta orden no debe recibirse ni vincularse a una salida 3Q.</span>
              </label>
              {cancelError && <div role="alert" className="border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{cancelError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <button type="button" onClick={closeCancel} disabled={submitting} className="px-4 py-2 text-sm text-muted hover:text-foreground disabled:opacity-50">Volver</button>
              <button type="submit" disabled={submitting || !confirmed || cancelReason.trim().length < 5} className="inline-flex items-center gap-2 bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50">
                <Ban size={15} /> {submitting ? 'Cancelando...' : 'Cancelar orden'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

function ReceptionTable({ rows, loading }) {
  const formatDate = (value) => value ? String(value).replace('T', ' ').slice(0, 16) : '-'
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[860px]">
        <thead>
          <tr className="bg-surface border-b border-border">
            {['Recepcion', 'OC / Maquila', 'Factura Siigo', 'Fecha', 'Proveedor', 'SKU', 'Producto', 'Lote', 'OC / Fact. acum. / Aceptado', 'Conciliacion', 'Usuario'].map((c) => (
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
              <td className="px-4 py-3 font-mono text-xs">{r.orden_compra_numero || '-'}{r.ordenes_maquila && <span className="block text-primary">{r.ordenes_maquila}</span>}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.siigo_purchase_name || '-'}</td>
              <td className="px-4 py-3 text-muted text-xs">{formatDate(r.completado_en || r.creado_en)}</td>
              <td className="px-4 py-3">{r.proveedor_nombre || '-'}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.sku || '-'}</td>
              <td className="px-4 py-3">{r.producto_nombre || '-'}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.lote || '-'}</td>
              <td className="px-4 py-3 tabular-nums text-xs">{r.cantidad_oc ?? '-'} / {r.cantidad_factura_acumulada ?? r.cantidad_factura ?? r.cantidad_esp ?? '-'} / {r.cantidad_aceptada_acumulada ?? r.cantidad_fisica ?? r.cantidad_rec ?? '-'}</td>
              <td className="px-4 py-3 tabular-nums text-xs"><span className={Number(r.saldo_oc) > 0 ? 'text-yellow-400' : 'text-green-400'}>Saldo OC: {r.saldo_oc ?? '-'}</span><span className={`block ${Number(r.diferencia_factura_fisica) !== 0 ? 'text-yellow-400' : 'text-muted'}`}>Factura-Fisico: {r.diferencia_factura_fisica ?? '-'}</span></td>
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('No fue posible leer el PDF'))
    reader.readAsDataURL(file)
  })
}

function Spin() {
  return <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
}
