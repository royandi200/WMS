import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Download, Factory, FileText, Plus, Send, X } from 'lucide-react'
import {
  confirmOutsourcingShipment,
  cancelOutsourcingShipment,
  createOutsourcingOrder,
  downloadWarehouseDocument,
  linkOutsourcingPurchaseOrder,
  listOutsourcingOrders,
  listWarehouseDocumentDrafts,
  prepareAdditionalOutsourcingShipment,
} from '../api/outsourcing.api'
import { listPurchaseOrders } from '../api/purchaseOrders.api'
import { listSuppliers } from '../api/suppliers.api'
import { useAuthStore } from '../store/authStore'
import { formatBogotaDateTime, formatDateOnly as formatCalendarDate } from '../utils/dateTime'

const STATUS = {
  MATERIALES_RESERVADOS: ['Materiales reservados', 'text-yellow-400 bg-yellow-400/10'],
  EN_3Q: ['En 3Q', 'text-blue-400 bg-blue-400/10'],
  EN_3Q_PENDIENTE_OC: ['En 3Q - OC pendiente', 'text-yellow-400 bg-yellow-400/10'],
  RECIBIDA_PARCIAL: ['Recepcion parcial', 'text-orange-400 bg-orange-400/10'],
  COMPLETADA: ['Completada', 'text-green-400 bg-green-400/10'],
  CANCELADA: ['Cancelada', 'text-muted bg-white/5'],
}

export default function OutsourcingPage() {
  const capabilities = useAuthStore((state) => state.user?.capabilities || [])
  const canManage = capabilities.includes('*') || capabilities.includes('outsourcing.manage')
  const [tab, setTab] = useState('list')
  const [data, setData] = useState({ rows: [], pending_shipments: [], document_drafts: [] })
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [outsourcing, orders, documents, supplierResponse] = await Promise.all([
        listOutsourcingOrders({ limit: 200 }),
        listPurchaseOrders({ limit: 200 }),
        listWarehouseDocumentDrafts({ limit: 200, type: 'SALIDA_BODEGA_3Q' }),
        listSuppliers(),
      ])
      setData({
        ...(outsourcing?.data || { rows: [], pending_shipments: [] }),
        document_drafts: documents?.data?.rows || [],
      })
      setPurchaseOrders(orders?.data?.rows || [])
      setSuppliers(supplierResponse?.data?.rows || [])
    } catch (error) {
      showToast(error.response?.data?.error || 'Error al cargar la maquila 3Q', false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const showToast = (message, ok) => {
    setToast({ message, ok })
    setTimeout(() => setToast(null), 4500)
  }

  const run = async (work, success) => {
    setLoading(true)
    try {
      await work()
      showToast(success, true)
      await load()
      return true
    } catch (error) {
      showToast(error.response?.data?.error || 'No fue posible completar la operacion', false)
      return false
    } finally {
      setLoading(false)
    }
  }

  const tabs = [
    ['list', 'Seguimiento'],
    ['documents', 'Documentos leidos'],
    ...(canManage ? [['create', 'Nueva remision'], ['link', 'Vincular OC'], ['additional', 'Material adicional']] : []),
  ]

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <Factory size={21} className="text-primary" />
        <div>
          <h1 className="text-lg md:text-xl font-semibold text-foreground">Maquila 3Q</h1>
          <p className="text-xs text-muted">Material enviado bajo custodia externa y producto terminado recibido.</p>
        </div>
      </div>

      <div className="flex gap-1 mb-5 border-b border-border overflow-x-auto pb-px">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'}`}>{label}</button>
        ))}
      </div>

      {toast && <div className={`mb-4 border px-4 py-3 text-sm ${toast.ok ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-danger/30 bg-danger/10 text-danger'}`}>{toast.message}</div>}

      {tab === 'list' && (
        <TrackingPanel
          rows={data.rows || []}
          shipments={data.pending_shipments || []}
          loading={loading}
          canManage={canManage}
          onConfirm={(shipment) => {
            const approved = window.confirm(`Confirmar salida fisica de ${shipment.numero}. Esta accion descuenta inventario de las ubicaciones indicadas.`)
            if (!approved) return Promise.resolve(false)
            return run(() => confirmOutsourcingShipment(shipment.id), `Remision ${shipment.numero} enviada a 3Q`)
          }}
          onCancel={(shipment) => {
            const approved = window.confirm(`Cancelar ${shipment.numero} y liberar sus reservas de inventario.`)
            if (!approved) return Promise.resolve(false)
            return run(() => cancelOutsourcingShipment(shipment.id), `Remision ${shipment.numero} cancelada`)
          }}
        />
      )}
      {tab === 'documents' && <DocumentDraftsPanel rows={data.document_drafts || []} loading={loading} />}
      {tab === 'create' && canManage && (
        <CreateForm
          purchaseOrders={purchaseOrders.filter((order) => order.documento_id && !['CANCELADA', 'CERRADA'].includes(order.estado))}
          suppliers={suppliers}
          loading={loading}
          onSubmit={(body) => run(() => createOutsourcingOrder(body), 'Orden 3Q preparada').then((ok) => { if (ok) setTab('list') })}
        />
      )}
      {tab === 'link' && canManage && (
        <LinkPurchaseOrderForm
          orders={(data.rows || []).filter((order) => !order.orden_compra_id && ['MATERIALES_RESERVADOS', 'EN_3Q_PENDIENTE_OC'].includes(order.estado))}
          purchaseOrders={purchaseOrders.filter((order) => order.documento_id && !['CANCELADA', 'CERRADA'].includes(order.estado))}
          loading={loading}
          onSubmit={(body) => run(() => linkOutsourcingPurchaseOrder(body), 'OC vinculada a la remision 3Q').then((ok) => { if (ok) setTab('list') })}
        />
      )}
      {tab === 'additional' && canManage && (
        <AdditionalForm
          orders={(data.rows || []).filter((order) => ['EN_3Q', 'RECIBIDA_PARCIAL'].includes(order.estado))}
          loading={loading}
          onSubmit={(body) => run(() => prepareAdditionalOutsourcingShipment(body), 'Remision adicional preparada').then((ok) => { if (ok) setTab('list') })}
        />
      )}
    </div>
  )
}

function DocumentDraftsPanel({ rows, loading }) {
  const download = async (row) => {
    if (!row.archivo_id) return
    const response = await downloadWarehouseDocument(row.archivo_id)
    const url = URL.createObjectURL(response.data)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = row.archivo_nombre || `${row.referencia_documento}.pdf`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return <div className="space-y-4">
    <div className="border-y border-border py-4">
      <div className="flex items-start gap-3">
        <FileText size={19} className="mt-0.5 text-primary" />
        <div><h2 className="text-sm font-semibold text-foreground">Lecturas documentales pendientes</h2><p className="mt-1 max-w-3xl text-xs text-muted">El PDF completa este borrador. Antes de descontar inventario, Sofi debe validar las referencias y vincularlo con una remision 3Q.</p></div>
      </div>
    </div>
    {loading && !rows.length && <p className="py-12 text-center text-sm text-muted">Cargando documentos...</p>}
    {!loading && !rows.length && <p className="py-12 text-center text-sm text-muted">No hay documentos leidos</p>}
    {rows.map((row) => {
      const needsCorrection = row.estado === 'REQUIERE_CORRECCION'
      return <article key={row.id} className="border border-border bg-surface/40">
        <header className="grid gap-4 border-b border-border px-4 py-4 lg:grid-cols-[minmax(0,1fr)_160px_180px_44px] lg:items-center">
          <div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-semibold text-foreground">{row.referencia_documento}</span><span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold ${needsCorrection ? 'bg-red-500/10 text-red-400' : 'bg-yellow-400/10 text-yellow-400'}`}>{needsCorrection ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}{needsCorrection ? 'Requiere correccion' : 'Pendiente de revision'}</span></div><p className="mt-1 text-xs text-muted">{row.tipo_documento} | Origen {row.origen} | Leido por {row.creado_por_nombre}</p></div>
          <div><p className="text-xs uppercase text-muted">Fecha documento</p><p className="mt-1 text-sm text-foreground">{formatDateOnly(row.fecha_documento)}</p></div>
          <div><p className="text-xs uppercase text-muted">Totales</p><p className="mt-1 text-sm text-foreground">{Number(row.total_unidades)} unidades{row.total_bultos != null ? ` | ${Number(row.total_bultos)} bultos` : ''}</p></div>
          <button type="button" disabled={!row.archivo_id} onClick={() => download(row)} title={row.archivo_id ? 'Descargar PDF original' : 'PDF no conservado'} className="inline-flex h-10 w-10 items-center justify-center border border-border text-primary disabled:cursor-not-allowed disabled:text-muted"><Download size={16} /></button>
        </header>
        <div className="grid gap-4 border-b border-border px-4 py-4 md:grid-cols-2 xl:grid-cols-4">
          <DocumentField label="Destinatario" value={row.destinatario_nombre} />
          <DocumentField label="Ciudad / departamento" value={row.ciudad_departamento} />
          <DocumentField label="Direccion" value={row.direccion} />
          <DocumentField label="NIT / documento" value={row.nit} />
          <DocumentField label="Telefono" value={row.telefono} />
          <DocumentField label="Entrega" value={row.entrega} />
          <DocumentField label="Recibe" value={row.recibe} />
          <DocumentField label="Remision WMS" value={row.remision_numero || 'Sin vincular'} emphasis={!row.remision_numero} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm"><thead><tr className="border-b border-border bg-surface">{['Codigo / SKU', 'Producto leido', 'Cantidad', 'Vencimiento', 'Lote', 'Catalogo WMS'].map((label) => <th key={label} className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted">{label}</th>)}</tr></thead><tbody>{(row.items || []).map((item, index) => <tr key={`${row.id}-${item.sku_extraido}-${index}`} className="border-b border-border/50"><td className="px-4 py-3 font-mono text-xs text-foreground">{item.sku_extraido}</td><td className="px-4 py-3 text-xs">{item.descripcion_extraida}</td><td className="px-4 py-3 tabular-nums">{Number(item.cantidad)} {item.unidad || ''}</td><td className="px-4 py-3 text-xs">{formatDateOnly(item.fecha_vencimiento)}</td><td className="px-4 py-3 font-mono text-xs">{item.lote || '-'}</td><td className={`px-4 py-3 text-xs ${item.producto_id ? 'text-green-400' : 'text-red-400'}`}>{item.producto_id ? `${item.sku_catalogo} - ${item.producto_catalogo}` : 'SKU no encontrado'}</td></tr>)}</tbody></table>
        </div>
        {(row.advertencias || []).length > 0 && <div className="border-t border-border bg-red-500/5 px-4 py-3"><p className="mb-1 text-xs font-semibold text-red-400">Validaciones pendientes</p>{row.advertencias.map((warning) => <p key={warning} className="text-xs text-muted">- {warning}</p>)}</div>}
      </article>
    })}
  </div>
}

function DocumentField({ label, value, emphasis = false }) {
  return <div><p className="text-xs uppercase text-muted">{label}</p><p className={`mt-1 text-sm ${emphasis ? 'text-yellow-400' : 'text-foreground'}`}>{value || '-'}</p></div>
}

function TrackingPanel({ rows, shipments, loading, canManage, onConfirm, onCancel }) {
  return (
    <div className="space-y-7">
      {shipments.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Remisiones pendientes de salida</h2>
          <div className="divide-y divide-border border-y border-border">
            {shipments.map((shipment) => (
              <div key={shipment.id} className="grid gap-3 py-4 lg:grid-cols-[180px_170px_minmax(0,1fr)_150px] lg:items-center">
                <div><p className="font-mono text-xs text-foreground">{shipment.numero}</p><p className="text-xs text-muted">{shipment.tipo}</p></div>
                <div><p className="font-mono text-xs text-foreground">{shipment.orden_codigo}</p><p className="text-xs text-muted">Destino externo: 3Q</p></div>
                <div className="space-y-1">
                  {shipment.items.map((item, index) => <p key={`${item.sku}-${item.lote}-${index}`} className="text-xs text-muted"><span className="font-mono text-foreground">{item.sku}</span> - {item.producto}: {item.cantidad} {item.unidad || ''} | lote {item.lote} | sale de {item.ubicacion_origen}</p>)}
                  {shipment.motivo && <p className="text-xs text-yellow-400">Motivo: {shipment.motivo}</p>}
                </div>
                {canManage && <div className="flex gap-2"><button type="button" disabled={loading} onClick={() => onConfirm(shipment)} className="btn-primary inline-flex flex-1 items-center justify-center gap-2"><Send size={15} /> Confirmar salida</button><button type="button" title="Cancelar remision" disabled={loading} onClick={() => onCancel(shipment)} className="inline-flex h-10 w-10 items-center justify-center border border-border text-muted hover:border-danger/50 hover:text-danger"><X size={16} /></button></div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Ordenes de maquila</h2>
        <div className="overflow-x-auto border border-border">
          <table className="w-full min-w-[1040px] text-sm">
            <thead><tr className="border-b border-border bg-surface">
              {['Orden 3Q', 'OC', 'Producto', 'Objetivo', 'Recibido disponible', 'Material enviado pendiente de conciliacion', 'Merma material', 'Estado', 'Creada'].map((label) => <th key={label} className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted">{label}</th>)}
            </tr></thead>
            <tbody>
              {loading && !rows.length && <tr><td colSpan={9} className="px-4 py-12 text-center text-muted">Cargando...</td></tr>}
              {!loading && !rows.length && <tr><td colSpan={9} className="px-4 py-12 text-center text-muted">Sin ordenes de maquila</td></tr>}
              {rows.map((row) => {
                const status = STATUS[row.estado] || [row.estado, 'text-muted bg-white/5']
                return <tr key={row.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{row.codigo}</td>
                  <td className={`px-4 py-3 text-xs ${row.orden_compra_numero ? 'font-mono' : 'text-yellow-400'}`}>{row.orden_compra_numero || 'Pendiente de vincular'}</td>
                  <td className="px-4 py-3"><span className="font-mono text-xs text-foreground">{row.sku}</span><span className="block max-w-[240px] truncate text-xs text-muted">{row.producto_nombre}</span></td>
                  <td className="px-4 py-3 tabular-nums">{Number(row.cantidad_objetivo)}</td>
                  <td className="px-4 py-3 tabular-nums text-green-400">{Number(row.cantidad_recibida)}</td>
                  <td className="px-4 py-3 text-xs text-blue-400">{(row.materiales || []).filter((item) => Number(item.cantidad_en_custodia) > 0).map((item) => <span key={item.sku} className="block"><span className="font-mono">{item.sku}</span>: {Number(item.cantidad_en_custodia)} {item.unidad || ''}</span>)}{!(row.materiales || []).some((item) => Number(item.cantidad_en_custodia) > 0) && <span className="text-muted">-</span>}</td>
                  <td className="px-4 py-3 text-xs text-red-400">{(row.materiales || []).filter((item) => Number(item.cantidad_merma) > 0).map((item) => <span key={item.sku} className="block"><span className="font-mono">{item.sku}</span>: {Number(item.cantidad_merma)} {item.unidad || ''}</span>)}{!(row.materiales || []).some((item) => Number(item.cantidad_merma) > 0) && <span className="text-muted">-</span>}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 text-xs font-semibold ${status[1]}`}>{status[0]}</span></td>
                  <td className="px-4 py-3 text-xs text-muted">{formatDate(row.creado_en)}</td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function CreateForm({ purchaseOrders, suppliers, loading, onSubmit }) {
  const [form, setForm] = useState({ orden_compra_id: '', tercero_id: '', sku: '', cantidad_objetivo: '', notas: '' })
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const submit = (event) => {
    event.preventDefault()
    onSubmit({
      ...form,
      orden_compra_id: form.orden_compra_id ? Number(form.orden_compra_id) : null,
      tercero_id: form.orden_compra_id ? null : Number(form.tercero_id),
      cantidad_objetivo: Number(form.cantidad_objetivo),
      clave_idempotencia: crypto.randomUUID(),
    })
  }
  return <form onSubmit={submit} className="max-w-2xl space-y-5 border-y border-border py-5">
    <div className="border border-yellow-400/30 bg-yellow-400/5 px-4 py-3 text-xs text-yellow-200">Puedes preparar y enviar materiales antes de recibir la OC. El producto terminado no podra recibirse hasta vincular una OC con PDF, proveedor, producto y cantidad coincidentes.</div>
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="OC del producto esperado (opcional)"><select value={form.orden_compra_id} onChange={set('orden_compra_id')} className="input-field"><option value="">Pendiente de cargar o vincular</option>{purchaseOrders.map((order) => <option key={order.id} value={order.id}>{order.numero} - {order.proveedor_nombre}</option>)}</select></Field>
      {!form.orden_compra_id && <Field label="Maquilador *"><select value={form.tercero_id} onChange={set('tercero_id')} className="input-field" required><option value="">Selecciona el maquilador</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.nombre}</option>)}</select></Field>}
      <Field label="SKU del producto terminado PT *"><input value={form.sku} onChange={set('sku')} placeholder="Ej. 00105-PTBOS60" className="input-field" required /></Field>
      <Field label="Cantidad esperada de 3Q *"><input type="number" min="0.0001" step="any" value={form.cantidad_objetivo} onChange={set('cantidad_objetivo')} className="input-field" required /></Field>
    </div>
    <Field label="Notas"><textarea value={form.notas} onChange={set('notas')} rows={2} className="input-field resize-none" /></Field>
    <button type="submit" disabled={loading} className="btn-primary inline-flex items-center gap-2"><Plus size={15} /> Preparar remision y picking</button>
  </form>
}

function LinkPurchaseOrderForm({ orders, purchaseOrders, loading, onSubmit }) {
  const [form, setForm] = useState({ orden_maquila_id: '', orden_compra_id: '' })
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const selectedOrder = orders.find((order) => String(order.id) === form.orden_maquila_id)
  const compatible = purchaseOrders.filter((order) => !selectedOrder || Number(order.tercero_id) === Number(selectedOrder.tercero_id))
  const submit = (event) => {
    event.preventDefault()
    onSubmit({ orden_maquila_id: Number(form.orden_maquila_id), orden_compra_id: Number(form.orden_compra_id) })
  }
  return <form onSubmit={submit} className="max-w-2xl space-y-5 border-y border-border py-5">
    <p className="text-xs text-muted">La vinculacion valida PDF, maquilador, producto y cantidad. Solo entonces se habilita la recepcion del producto terminado.</p>
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Remision / orden 3Q sin OC *"><select value={form.orden_maquila_id} onChange={set('orden_maquila_id')} className="input-field" required><option value="">Selecciona una orden 3Q</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.codigo} - {order.sku} ({Number(order.cantidad_objetivo)})</option>)}</select></Field>
      <Field label="Orden de compra con PDF *"><select value={form.orden_compra_id} onChange={set('orden_compra_id')} className="input-field" required><option value="">Selecciona una OC compatible</option>{compatible.map((order) => <option key={order.id} value={order.id}>{order.numero} - {order.proveedor_nombre}</option>)}</select></Field>
    </div>
    <button type="submit" disabled={loading || !orders.length} className="btn-primary inline-flex items-center gap-2"><FileText size={15} /> Validar y vincular OC</button>
  </form>
}

function AdditionalForm({ orders, loading, onSubmit }) {
  const [form, setForm] = useState({ orden_maquila_id: '', sku: '', cantidad: '', motivo: '' })
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const submit = (event) => {
    event.preventDefault()
    onSubmit({ ...form, cantidad: Number(form.cantidad), clave_idempotencia: crypto.randomUUID() })
  }
  return <form onSubmit={submit} className="max-w-2xl space-y-5 border-y border-border py-5">
    <p className="text-xs text-yellow-400">El material adicional quedara separado para la conciliacion de merma de la maquila.</p>
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Orden 3Q *"><select value={form.orden_maquila_id} onChange={set('orden_maquila_id')} className="input-field" required><option value="">Selecciona una orden</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.codigo} - {order.sku}</option>)}</select></Field>
      <Field label="SKU del material *"><input value={form.sku} onChange={set('sku')} className="input-field" required /></Field>
      <Field label="Cantidad adicional *"><input type="number" min="0.0001" step="any" value={form.cantidad} onChange={set('cantidad')} className="input-field" required /></Field>
      <Field label="Motivo *"><input value={form.motivo} onChange={set('motivo')} className="input-field" required /></Field>
    </div>
    <button type="submit" disabled={loading} className="btn-primary inline-flex items-center gap-2"><ArrowRight size={15} /> Preparar remision adicional</button>
  </form>
}

function Field({ label, children }) {
  return <div><label className="mb-1 block text-xs font-medium text-muted">{label}</label>{children}</div>
}

function formatDate(value) {
  return formatBogotaDateTime(value)
}

function formatDateOnly(value) {
  return formatCalendarDate(value)
}
