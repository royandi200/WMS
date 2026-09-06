import { useEffect, useState } from 'react'
import { Ban, Download, FileText, Plus, Trash2, X } from 'lucide-react'
import { useReceptionStore } from '../store/receptionStore'
import { formatBogotaDateTime } from '../utils/dateTime'
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  discardPurchaseOrderDocumentDraft,
  downloadPurchaseOrderDocument,
  downloadPurchaseOrderDraftDocument,
  listPurchaseOrderDocumentDrafts,
  listPurchaseOrders,
} from '../api/purchaseOrders.api'
import { listSuppliers } from '../api/suppliers.api'
import {
  confirmReception,
  prepareReceptionFromOutsourcing,
  prepareReceptionFromPurchaseOrder,
} from '../api/reception.api'
import { listOutsourcingOrders } from '../api/outsourcing.api'
import { listUbicaciones } from '../api/inventory.api'
import { useAuthStore } from '../store/authStore'

const RECEPTION_TABS = [
  { key: 'orders', label: 'Ordenes de compra', capability: 'reception.create' },
  { key: 'confirm', label: 'Confirmar recepcion', capability: 'reception.confirm' },
  { key: 'history', label: 'Historico', capability: 'reception.read' },
]

function formatQuantity(value) {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 4 }).format(Number(value || 0))
}

function formatUnitTotals(totals = []) {
  if (!totals.length) return '-'
  return totals.map((total) => `${formatQuantity(total.quantity)} ${total.unit}`).join(' + ')
}

function totalsFromItems(items = []) {
  const totals = new Map()
  for (const item of items) {
    const unit = String(item.unidad || 'sin unidad').trim().toLowerCase() || 'sin unidad'
    totals.set(unit, Number(((totals.get(unit) || 0) + Number(item.cantidad || 0)).toFixed(4)))
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([unit, quantity]) => ({ unit, quantity }))
}

export default function RecepcionPage() {
  const [tab, setTab] = useState('orders')
  const [toast, setToast] = useState(null)
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [purchaseOrderDrafts, setPurchaseOrderDrafts] = useState([])
  const [purchaseLoading, setPurchaseLoading] = useState(false)
  const [locations, setLocations] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [outsourcingOrders, setOutsourcingOrders] = useState([])
  const { loading, list, fetchList } = useReceptionStore()
  const user = useAuthStore((state) => state.user)
  const capabilities = user?.capabilities || []
  const legacyAdmin = ['admin', 'administrador'].includes(String(user?.rol || '').toLowerCase())
  const allowed = (capability) => legacyAdmin || capabilities.includes('*') || capabilities.includes(capability)
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
      if (tab === 'orders') {
        listPurchaseOrderDocumentDrafts({ limit: 100 })
          .then((payload) => setPurchaseOrderDrafts(payload?.data?.rows || []))
          .catch((error) => showToast(error.response?.data?.error || 'Error al cargar borradores de OC', false))
      }
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
          drafts={purchaseOrderDrafts}
          suppliers={suppliers}
          loading={purchaseLoading}
          canCancel={allowed('purchase_order.cancel')}
          canDiscardDraft={allowed('purchase_order.cancel')}
          onCreate={async (body) => {
            setPurchaseLoading(true)
            try {
              const payload = await createPurchaseOrder(body)
              const refreshed = await listPurchaseOrders({ limit: 100 })
              const refreshedDrafts = await listPurchaseOrderDocumentDrafts({ limit: 100 })
              setPurchaseOrders(refreshed?.data?.rows || [])
              setPurchaseOrderDrafts(refreshedDrafts?.data?.rows || [])
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
          onDiscardDraft={async (id, motivo) => {
            setPurchaseLoading(true)
            try {
              const payload = await discardPurchaseOrderDocumentDraft(id, motivo)
              const refreshed = await listPurchaseOrderDocumentDrafts({ limit: 100 })
              setPurchaseOrderDrafts(refreshed?.data?.rows || [])
              const duplicate = payload?.data?.duplicate
              showToast(duplicate ? 'El borrador ya estaba descartado' : `Borrador ${payload?.data?.referencia_documento || ''} descartado`, true)
              return { ok: true }
            } catch (error) {
              const message = error.response?.data?.error || 'Error al descartar el borrador'
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
          purchaseOrders={purchaseOrders}
          outsourcingOrders={outsourcingOrders}
          locations={locations}
          loading={loading || purchaseLoading}
          onPrepare={async (purchaseOrderId) => {
            try {
              const payload = await prepareReceptionFromPurchaseOrder(purchaseOrderId)
              await fetchList({ limit: 200 })
              return { ok: true, data: payload?.data }
            } catch (error) {
              const message = error.response?.data?.error || 'Error al preparar la recepcion desde la OC'
              showToast(message, false)
              return { ok: false, message }
            }
          }}
          onPrepareOutsourcing={async (outsourcingOrderId, deliveryQuantity) => {
            try {
              const payload = await prepareReceptionFromOutsourcing(outsourcingOrderId, deliveryQuantity)
              await fetchList({ limit: 200 })
              return { ok: true, data: payload?.data }
            } catch (error) {
              const message = error.response?.data?.error || 'Error al preparar la recepcion desde 3Q'
              showToast(message, false)
              return { ok: false, message }
            }
          }}
          onConfirm={async (body) => {
            try {
              const payload = await confirmReception(body)
              showToast(`Recepcion ${payload?.data?.numero || ''} confirmada`, true)
              const [outsourcingPayload] = await Promise.all([
                listOutsourcingOrders({ limit: 200 }),
                fetchList({ limit: 200 }),
              ])
              setOutsourcingOrders(outsourcingPayload?.data?.rows || [])
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

function ConfirmReceptionPanel({ purchaseOrders, outsourcingOrders, locations, loading, onPrepare, onPrepareOutsourcing, onConfirm }) {
  const [source, setSource] = useState('purchase')
  const [receptionId, setReceptionId] = useState('')
  const [purchaseOrderId, setPurchaseOrderId] = useState('')
  const [outsourcingOrderId, setOutsourcingOrderId] = useState('')
  const [deliveryQuantity, setDeliveryQuantity] = useState('')
  const [receptionNumber, setReceptionNumber] = useState('')
  const [items, setItems] = useState([])

  const prepare = async () => {
    const result = source === 'outsourcing'
      ? await onPrepareOutsourcing(Number(outsourcingOrderId), Number(deliveryQuantity))
      : await onPrepare(Number(purchaseOrderId))
    if (!result.ok) return
    const reception = result.data
    setReceptionId(String(reception.id))
    setReceptionNumber(reception.numero)
    setPurchaseOrderId(String(reception.orden_compra_id || purchaseOrderId))
    setItems((reception.items || []).map((item) => ({
      item_id: item.item_id,
      reception_item_id: item.item_id,
      sku: item.sku,
      producto: item.producto,
      expected: Number(item.cantidad_pendiente || 0),
      unit: item.unidad || 'und',
      outsourcingOrderId: item.orden_maquila_id || reception.orden_maquila_id || null,
      requiresLot: true,
      suggestedLocation: item.ubicacion_sugerida || '',
      suggestedLocations: Array.isArray(item.ubicaciones_sugeridas) ? item.ubicaciones_sugeridas : [],
      documentLot: item.lote_documento || '',
      documentExpiry: String(item.fecha_vencimiento_documento || '').slice(0, 10),
      reason: '',
      distributions: [{ condicion: '', cantidad: '', lote: '', ubicacion_id: '', fecha_venc: '', motivo: '' }],
    })))
  }
  const setDistribution = (itemIndex, distributionIndex, key, value) => setItems((current) => current.map((item, index) => index !== itemIndex ? item : {
    ...item,
    distributions: item.distributions.map((distribution, indexDistribution) => indexDistribution === distributionIndex ? { ...distribution, [key]: value } : distribution),
  }))
  const addDistribution = (itemIndex) => setItems((current) => current.map((item, index) => index !== itemIndex ? item : {
    ...item,
    distributions: [...item.distributions, { condicion: '', cantidad: '', lote: '', ubicacion_id: '', fecha_venc: '', motivo: '' }],
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
        motivo: item.reason || undefined,
        orden_maquila_id: item.outsourcingOrderId || undefined,
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
      setOutsourcingOrderId('')
      setDeliveryQuantity('')
      setReceptionNumber('')
      setItems([])
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="inline-flex border border-border p-1" aria-label="Origen de la recepcion">
        <button type="button" onClick={() => {
          setSource('purchase')
          setOutsourcingOrderId('')
          setDeliveryQuantity('')
        }} disabled={Boolean(receptionId)} className={`px-3 py-2 text-sm ${source === 'purchase' ? 'bg-primary text-white' : 'text-muted hover:text-foreground'}`}>Compra directa</button>
        <button type="button" onClick={() => {
          setSource('outsourcing')
          setPurchaseOrderId('')
        }} disabled={Boolean(receptionId)} className={`px-3 py-2 text-sm ${source === 'outsourcing' ? 'bg-primary text-white' : 'text-muted hover:text-foreground'}`}>Producto desde 3Q</button>
      </div>
      <div className={`grid gap-3 max-w-4xl items-end ${source === 'outsourcing' ? 'md:grid-cols-[minmax(0,1fr)_170px_auto]' : 'md:grid-cols-[minmax(0,1fr)_auto]'}`}>
        {source === 'purchase' ? <Field label="Orden de compra *">
          <select value={purchaseOrderId} onChange={(event) => {
            setPurchaseOrderId(event.target.value)
            setReceptionId('')
            setReceptionNumber('')
            setItems([])
          }} className="input-field" required disabled={Boolean(receptionId)}>
            <option value="">Selecciona la OC</option>
            {purchaseOrders.filter((order) => ['CARGADA', 'RECIBIDA', 'RECIBIDA_PARCIAL'].includes(order.estado)).map((order) => <option key={order.id} value={order.id}>{order.numero} - {order.proveedor_nombre}</option>)}
          </select>
        </Field> : <>
          <Field label="Orden de maquila 3Q *">
            <select value={outsourcingOrderId} onChange={(event) => {
              const id = event.target.value
              const order = outsourcingOrders.find((item) => String(item.id) === id)
              setOutsourcingOrderId(id)
              setDeliveryQuantity(order ? String(Number(order.cantidad_objetivo) - Number(order.cantidad_recibida)) : '')
              setReceptionId('')
              setReceptionNumber('')
              setItems([])
            }} className="input-field" required disabled={Boolean(receptionId)}>
              <option value="">Selecciona la orden 3Q</option>
              {outsourcingOrders.filter((order) => ['EN_3Q', 'RECIBIDA_PARCIAL'].includes(order.estado)).map((order) => (
                <option key={order.id} value={order.id}>{order.codigo} - {order.sku} - saldo {formatQuantity(Number(order.cantidad_objetivo) - Number(order.cantidad_recibida))}</option>
              ))}
            </select>
          </Field>
          <Field label="Cantidad de esta entrega *">
            <input type="number" min="0.0001" step="any" value={deliveryQuantity} onChange={(event) => setDeliveryQuantity(event.target.value)} className="input-field" required disabled={Boolean(receptionId)} />
          </Field>
        </>}
        <button type="button" onClick={prepare} disabled={(source === 'purchase' ? !purchaseOrderId : !outsourcingOrderId || !Number(deliveryQuantity)) || loading || Boolean(receptionId)} className="btn-primary h-10 disabled:opacity-40">
          {loading ? 'Preparando...' : 'Iniciar recepcion fisica'}
        </button>
      </div>
      {receptionId && <p className="text-xs text-muted">Recepcion preparada: <span className="font-mono text-foreground">{receptionNumber}</span>. El inventario solo cambiara al aprobar.</p>}
      {items.map((item, itemIndex) => (
        <section key={item.item_id} className="border-y border-border py-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">{item.sku} - {item.producto}</p>
            <p className="text-xs text-muted">{item.outsourcingOrderId ? 'Cantidad de esta entrega 3Q' : 'Pendiente de la OC'}: {formatQuantity(item.expected)} {item.unit}</p>
            {item.suggestedLocation && <p className="text-xs text-primary">Ubicacion preferida: {item.suggestedLocation}. Puedes seleccionar otra ubicacion activa si la operacion lo requiere.</p>}
            {(item.documentLot || item.documentExpiry) && <p className="text-xs text-muted">Referencia del PDF: lote {item.documentLot || 'no informado'} | vence {item.documentExpiry || 'no informado'}. Coteja ambos contra la etiqueta fisica.</p>}
            <p className="text-xs text-muted">Registra los datos fisicos completos. El PDF y la ubicacion preferida no se confirman automaticamente.</p>
          </div>
          {item.distributions.map((distribution, distributionIndex) => (
            <div key={distributionIndex} className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-[150px_110px_minmax(150px,1fr)_minmax(170px,1fr)_140px_36px] gap-2 items-end">
                <Field label="Condicion *"><select value={distribution.condicion} onChange={(event) => {
                  const condition = event.target.value
                  setDistribution(itemIndex, distributionIndex, 'condicion', condition)
                }} className="input-field" required><option value="">Selecciona condicion</option><option>DISPONIBLE</option><option>CUARENTENA</option><option>RECHAZADO</option><option>PENDIENTE_DISPOSICION</option></select></Field>
                <Field label="Cantidad fisica *"><input type="number" min="0.0001" step="any" value={distribution.cantidad} onChange={(event) => setDistribution(itemIndex, distributionIndex, 'cantidad', event.target.value)} className="input-field" required /></Field>
                <Field label="Lote proveedor *"><input value={distribution.lote} onChange={(event) => setDistribution(itemIndex, distributionIndex, 'lote', event.target.value)} className="input-field" required /></Field>
                <Field label="Ubicacion *"><select value={distribution.ubicacion_id} onChange={(event) => setDistribution(itemIndex, distributionIndex, 'ubicacion_id', event.target.value)} className="input-field" required><option value="">Selecciona ubicacion</option>{locations.map((location) => <option key={location.id} value={location.id}>{item.suggestedLocations.some((suggested) => Number(suggested.id) === Number(location.id)) ? 'Preferida - ' : ''}{location.bodega_codigo} / {location.codigo}</option>)}</select></Field>
                <Field label="Vencimiento *"><input type="date" value={distribution.fecha_venc} onChange={(event) => setDistribution(itemIndex, distributionIndex, 'fecha_venc', event.target.value)} className="input-field" required /></Field>
                <button type="button" title="Eliminar distribucion" onClick={() => removeDistribution(itemIndex, distributionIndex)} disabled={item.distributions.length === 1} className="h-10 w-9 inline-flex items-center justify-center text-muted hover:text-danger disabled:opacity-30"><Trash2 size={16} /></button>
              </div>
              {distribution.condicion !== 'DISPONIBLE' && <Field label="Motivo *"><input value={distribution.motivo} onChange={(event) => setDistribution(itemIndex, distributionIndex, 'motivo', event.target.value)} className="input-field max-w-2xl" required /></Field>}
            </div>
          ))}
          {Math.abs(item.distributions.reduce((sum, distribution) => sum + Number(distribution.cantidad || 0), 0) - item.expected) > 0.0001 && (
            <Field label="Motivo de la diferencia *"><input value={item.reason} onChange={(event) => setItems((current) => current.map((entry, index) => index === itemIndex ? { ...entry, reason: event.target.value } : entry))} className="input-field max-w-2xl" required /></Field>
          )}
          <button type="button" onClick={() => addDistribution(itemIndex)} className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80"><Plus size={15} /> Otra ubicacion o condicion</button>
        </section>
      ))}
      {receptionId && (
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Confirmando...' : 'Aprobar recepcion fisica'}</button>
          <button type="button" onClick={() => {
            setReceptionId('')
            setReceptionNumber('')
            setPurchaseOrderId('')
            setOutsourcingOrderId('')
            setDeliveryQuantity('')
            setItems([])
          }} disabled={loading} className="px-3 py-2 border border-border text-sm text-muted hover:text-foreground disabled:opacity-40">Cambiar origen</button>
        </div>
      )}
      {!receptionId && !loading && <div className="py-10 text-center text-sm text-muted">Selecciona una orden abierta para registrar lo que llego fisicamente.</div>}
    </form>
  )
}

const EMPTY_PO = {
  document_draft_id: null,
  numero: '',
  tercero_id: '',
  fecha_orden: '',
  documento_pdf: null,
  items: [{ sku: '', cantidad: '', unidad: 'und' }],
}

function PurchaseOrdersPanel({ rows, drafts, suppliers, loading, canCancel, canDiscardDraft, onCreate, onCancel, onDiscardDraft }) {
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
  const reviewDraft = (draft) => {
    setForm({
      document_draft_id: draft.id,
      numero: draft.referencia_documento,
      tercero_id: draft.tercero_id || '',
      fecha_orden: String(draft.fecha_documento || '').slice(0, 10),
      documento_pdf: null,
      items: (draft.items || []).map((item) => ({
        sku: item.sku_extraido || '',
        cantidad: Number(item.cantidad),
        unidad: item.unidad || '',
        lote_documento: item.lote || '',
        fecha_vencimiento_documento: String(item.fecha_vencimiento || '').slice(0, 10),
      })),
    })
    setFormError('')
    setCreating(true)
  }
  const closeForm = () => {
    setForm(EMPTY_PO)
    setFormError('')
    setCreating(false)
  }
  const submit = async (event) => {
    event.preventDefault()
    setFormError('')
    if (!form.documento_pdf && !form.document_draft_id) {
      setFormError('Debes seleccionar la orden de compra en PDF.')
      return
    }
    try {
      const pdf = form.documento_pdf ? await readFileAsDataUrl(form.documento_pdf) : null
      const payload = {
        ...form,
        tercero_id: Number(form.tercero_id),
        fecha_orden: form.fecha_orden || undefined,
        items: form.items.map((item) => ({
          ...item,
          sku: item.sku.trim(),
          unidad: item.unidad.trim(),
          cantidad: Number(item.cantidad),
        })),
      }
      if (form.documento_pdf) {
        payload.archivo_nombre = form.documento_pdf.name
        payload.documento_pdf = {
          nombre: form.documento_pdf.name,
          mime_type: form.documento_pdf.type || 'application/pdf',
          base64: pdf,
        }
      }
      const result = await onCreate(payload)
      if (result.ok) {
        closeForm()
      } else {
        setFormError(result.message || 'No fue posible cargar la orden de compra.')
      }
    } catch (error) {
      setFormError(error.message || 'No fue posible leer el PDF seleccionado.')
    }
  }

  return (
    <div className="space-y-4">
      <PurchaseOrderDrafts
        rows={drafts}
        loading={loading}
        canDiscard={canDiscardDraft}
        onReview={reviewDraft}
        onDiscard={onDiscardDraft}
      />
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Ordenes esperadas</p>
          <p className="text-xs text-muted">No generan stock hasta confirmar la recepcion fisica.</p>
        </div>
        <button type="button" onClick={() => creating ? closeForm() : setCreating(true)} className="btn-primary inline-flex items-center gap-2">
          <Plus size={16} /> Nueva OC
        </button>
      </div>

      {creating && (
        <form onSubmit={submit} className="border-y border-border py-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Numero de OC *"><input value={form.numero} onChange={setHeader('numero')} readOnly={Boolean(form.document_draft_id)} className="input-field read-only:opacity-70" required /></Field>
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
          {form.document_draft_id ? (
            <div className="flex items-center gap-3 border border-border bg-surface/40 px-4 py-3 text-sm text-foreground">
              <FileText size={20} className="text-primary" />
              PDF recibido por WhatsApp. Revisa los datos extraidos antes de crear la OC operativa.
            </div>
          ) : <Field label="Orden de compra en PDF *">
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
          </Field>}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">Items</p>
            {form.items.map((item, index) => (
              <div key={index} className="space-y-1">
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px_100px_36px] gap-2">
                  <input value={item.sku} onChange={(event) => setItem(index, 'sku', event.target.value)} placeholder="SKU" pattern="[A-Za-z0-9._&amp;-]+" title="Usa solo letras, numeros, punto, guion, guion bajo o &amp;" className="input-field" required />
                  <input type="number" min="0.0001" step="any" value={item.cantidad} onChange={(event) => setItem(index, 'cantidad', event.target.value)} placeholder="Cantidad" className="input-field" required />
                  <input value={item.unidad} onChange={(event) => setItem(index, 'unidad', event.target.value)} placeholder="Unidad" className="input-field" />
                  <button type="button" onClick={() => removeItem(index)} disabled={form.items.length === 1} title="Eliminar item" className="h-10 w-9 inline-flex items-center justify-center text-muted hover:text-danger disabled:opacity-30">
                    <Trash2 size={16} />
                  </button>
                </div>
                {(item.lote_documento || item.fecha_vencimiento_documento) && (
                  <p className="px-1 text-xs text-muted">
                    PDF: {item.lote_documento ? `lote ${item.lote_documento}` : 'sin lote'}
                    {item.fecha_vencimiento_documento ? ` | vence ${item.fecha_vencimiento_documento}` : ''}
                  </p>
                )}
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
            <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Cargando...' : form.document_draft_id ? 'Confirmar y crear OC' : 'Cargar orden'}</button>
            <button type="button" onClick={closeForm} className="px-3 py-2 border border-border text-sm text-muted hover:text-foreground">Cancelar</button>
          </div>
        </form>
      )}

      <PurchaseOrderTable rows={rows} loading={loading} canCancel={canCancel} onCancel={onCancel} />
    </div>
  )
}

function PurchaseOrderDrafts({ rows = [], loading, canDiscard, onReview, onDiscard }) {
  const [discardTarget, setDiscardTarget] = useState(null)
  const [discardReason, setDiscardReason] = useState('')
  const [discardConfirmed, setDiscardConfirmed] = useState(false)
  const [discardSubmitting, setDiscardSubmitting] = useState(false)
  const [discardError, setDiscardError] = useState('')
  const pending = rows.filter((row) => !['VINCULADO', 'DESCARTADO'].includes(row.estado))
  if (!loading && pending.length === 0 && !discardTarget) return null

  const closeDiscard = () => {
    setDiscardTarget(null)
    setDiscardReason('')
    setDiscardConfirmed(false)
    setDiscardError('')
  }
  const submitDiscard = async (event) => {
    event.preventDefault()
    setDiscardError('')
    if (discardReason.trim().length < 5) {
      setDiscardError('Escribe un motivo de al menos 5 caracteres.')
      return
    }
    if (!discardConfirmed) {
      setDiscardError('Confirma que deseas descartar este borrador.')
      return
    }
    setDiscardSubmitting(true)
    const result = await onDiscard(discardTarget.id, discardReason.trim())
    setDiscardSubmitting(false)
    if (result.ok) closeDiscard()
    else setDiscardError(result.message)
  }

  return (
    <>
      <section className="border-y border-border py-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">PDF recibidos por WhatsApp</h2>
          <p className="text-xs text-muted">Son borradores. No habilitan recepciones ni modifican inventario hasta su revision.</p>
        </div>
        {loading && !pending.length && <p className="text-sm text-muted">Cargando borradores...</p>}
        {pending.map((row) => (
          <article key={row.id} className="grid gap-3 border border-border bg-surface/40 p-4 lg:grid-cols-[minmax(0,1fr)_170px_150px_auto] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-foreground">{row.referencia_documento}</span>
                <span className={`px-2 py-1 text-xs font-semibold ${row.estado === 'REQUIERE_CORRECCION' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-400/10 text-yellow-400'}`}>
                  {row.estado === 'REQUIERE_CORRECCION' ? 'Requiere correccion' : 'Pendiente de revision'}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">{row.destinatario_nombre} | {(row.items || []).length} items | {formatUnitTotals(totalsFromItems(row.items))}</p>
              {(row.advertencias || []).slice(0, 2).map((warning) => <p key={warning} className={`mt-1 text-xs ${row.estado === 'REQUIERE_CORRECCION' ? 'text-red-400' : 'text-yellow-400'}`}>{warning}</p>)}
            </div>
            <div><p className="text-xs uppercase text-muted">Fecha OC</p><p className="text-sm text-foreground">{String(row.fecha_documento || '').slice(0, 10)}</p></div>
            <div><p className="text-xs uppercase text-muted">PDF</p>{row.archivo_id ? <button type="button" onClick={() => downloadPurchaseOrderDraftDocument(row.archivo_id, row.archivo_nombre)} className="mt-1 inline-flex items-center gap-2 text-sm text-primary"><Download size={15} /> Descargar</button> : <p className="mt-1 text-xs text-danger">No conservado</p>}</div>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => onReview(row)} disabled={!row.archivo_id} className="btn-primary disabled:opacity-40">Revisar</button>
              {canDiscard && (
                <button
                  type="button"
                  title="Descartar borrador"
                  aria-label={`Descartar borrador ${row.referencia_documento}`}
                  onClick={() => setDiscardTarget(row)}
                  className="inline-flex h-10 w-10 items-center justify-center border border-border text-muted hover:border-danger/50 hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 size={17} />
                </button>
              )}
            </div>
          </article>
        ))}
      </section>

      {discardTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="discard-draft-title">
          <form onSubmit={submitDiscard} className="w-full max-w-lg border border-border bg-surface shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 id="discard-draft-title" className="text-base font-semibold text-foreground">Descartar borrador</h2>
                <p className="mt-1 font-mono text-xs text-muted">{discardTarget.referencia_documento}</p>
              </div>
              <button type="button" onClick={closeDiscard} title="Cerrar" className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted hover:text-foreground">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <p className="text-sm text-muted">Se retirara de los borradores pendientes. El PDF y el registro se conservaran para auditoria; esta accion no modifica inventario.</p>
              <Field label="Motivo *">
                <textarea
                  value={discardReason}
                  onChange={(event) => setDiscardReason(event.target.value)}
                  maxLength={300}
                  rows={3}
                  className="input-field resize-y"
                  placeholder="Ej. Lectura incorrecta o documento duplicado"
                  autoFocus
                  required
                />
              </Field>
              <label className="flex cursor-pointer items-start gap-3 text-sm text-foreground">
                <input type="checkbox" checked={discardConfirmed} onChange={(event) => setDiscardConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-500" />
                <span>Confirmo que este borrador no debe convertirse en una orden de compra.</span>
              </label>
              {discardError && <div role="alert" className="border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{discardError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <button type="button" onClick={closeDiscard} disabled={discardSubmitting} className="px-4 py-2 text-sm text-muted hover:text-foreground disabled:opacity-50">Volver</button>
              <button type="submit" disabled={discardSubmitting || !discardConfirmed || discardReason.trim().length < 5} className="inline-flex items-center gap-2 bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50">
                <Trash2 size={15} /> {discardSubmitting ? 'Descartando...' : 'Descartar borrador'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

function PurchaseOrderTable({ rows, loading, canCancel, onCancel }) {
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const formatDate = formatBogotaDateTime
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
          {['Orden', 'PDF', 'Proveedor', 'Fecha OC', 'Estado', 'Items', 'Cantidades', 'Cargada por', 'Creada', 'Acciones'].map((label) => (
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
              <td className="px-4 py-3 tabular-nums whitespace-nowrap">{formatUnitTotals(row.totales_por_unidad)}</td>
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
  const formatDate = formatBogotaDateTime
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[860px]">
        <thead>
          <tr className="bg-surface border-b border-border">
            {['Recepcion', 'OC / Maquila', 'Factura Siigo', 'Fecha', 'Proveedor', 'SKU', 'Producto', 'Lote', 'OC / Documento / Aceptado', 'Conciliacion', 'Usuario'].map((c) => (
              <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted">Cargando recepciones...</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted">Sin recepciones registradas</td></tr>}
          {!loading && rows.map((r) => {
            const usesSiigoInvoice = r.origen_recepcion === 'SIIGO' && Boolean(r.siigo_purchase_id || r.siigo_purchase_name)
            const documentQuantity = usesSiigoInvoice
              ? (r.cantidad_factura_acumulada ?? r.cantidad_factura)
              : r.cantidad_esp
            const documentDifference = usesSiigoInvoice
              ? r.diferencia_factura_fisica
              : Number(r.cantidad_esp || 0) - Number(r.cantidad_rec || 0)
            return (
            <tr key={`${r.id}-${r.lote || ''}`} className="border-b border-border/50 hover:bg-white/[0.02]">
              <td className="px-4 py-3 font-mono text-xs">{r.numero}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.orden_compra_numero || '-'}{r.ordenes_maquila && <span className="block text-primary">{r.ordenes_maquila}</span>}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.siigo_purchase_name || '-'}</td>
              <td className="px-4 py-3 text-muted text-xs">{formatDate(r.completado_en || r.creado_en)}</td>
              <td className="px-4 py-3">{r.proveedor_nombre || '-'}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.sku || '-'}</td>
              <td className="px-4 py-3">{r.producto_nombre || '-'}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.lote || '-'}</td>
              <td className="px-4 py-3 tabular-nums text-xs">{r.cantidad_oc ?? '-'} / {documentQuantity ?? '-'} / {r.cantidad_aceptada_acumulada ?? r.cantidad_fisica ?? r.cantidad_rec ?? '-'}</td>
              <td className="px-4 py-3 tabular-nums text-xs"><span className={Number(r.saldo_oc) > 0 ? 'text-yellow-400' : 'text-green-400'}>Saldo OC: {r.saldo_oc ?? '-'}</span><span className={`block ${Number(documentDifference) !== 0 ? 'text-yellow-400' : 'text-muted'}`}>{usesSiigoInvoice ? 'Factura-Fisico' : 'Documento-Fisico'}: {documentDifference ?? '-'}</span></td>
              <td className="px-4 py-3">{r.usuario_nombre || '-'}</td>
            </tr>
            )
          })}
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
