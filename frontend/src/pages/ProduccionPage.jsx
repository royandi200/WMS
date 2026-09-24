import { useEffect, useState } from 'react'
import { Ban, X } from 'lucide-react'
import { useProductionStore } from '../store/productionStore'
import { listUbicaciones } from '../api/inventory.api'
import { useAuthStore } from '../store/authStore'
import { formatBogotaDateTime } from '../utils/dateTime'
import {
  approveCustomerOrder, discardCustomerOrderDraft, downloadCustomerOrderPdf, listCustomerOrderDrafts,
  listCustomerOrders, uploadCustomerOrderPdf,
} from '../api/customerOrders.api'

const PHASES = ['F1', 'F2', 'F3', 'F4', 'F5']
const STATUS_LABEL = {
  PLANEADA: { label: 'Planeada', css: 'text-yellow-400 bg-yellow-400/10' },
  APROBADA: { label: 'Aprobada', css: 'text-emerald-400 bg-emerald-400/10' },
  EN_PROCESO: { label: 'En proceso', css: 'text-blue-400 bg-blue-400/10' },
  CERRADA: { label: 'Cerrada', css: 'text-green-400 bg-green-400/10' },
  CANCELADA: { label: 'Cancelada', css: 'text-muted bg-white/5' },
}
const TABS = ['Listado', 'Nueva orden', 'Confirmar materiales', 'Ajustar materiales', 'Preparar reposición', 'Confirmar reposición', 'Avanzar fase', 'Cerrar orden', 'Pedidos de cliente']
const TAB_CAPABILITIES = ['production.read', 'production.release', 'production.pick', 'production.pick', 'production.release', 'production.pick', 'production.advance', 'production.close', 'production.release']

const empty = '-'
const safeDate = (val) => {
  if (!val) return empty
  return formatBogotaDateTime(val).split(',')[0]
}
const safeTime = (val) => {
  if (!val) return empty
  return formatBogotaDateTime(val).split(',')[1]?.trim() || empty
}

export default function ProduccionPage() {
  const [tab, setTab] = useState(0)
  const [locations, setLocations] = useState([])
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelConfirmed, setCancelConfirmed] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [listToast, setListToast] = useState(null)
  const {
    list, loading, error, fetchList, start, confirm, adjustMaterials,
    prepareReplenishment, confirmReplenishment, cancelReplenishment, advance, close, cancelOrder, clearError,
  } = useProductionStore()
  const capabilities = useAuthStore((state) => state.user?.capabilities || [])
  const role = useAuthStore((state) => state.user?.rol || '')
  const canCancelOrder = capabilities.includes('*') || capabilities.includes('production.release')
  const visibleTabs = TABS.map((label, index) => ({ label, index, capability: TAB_CAPABILITIES[index] }))
    .filter((item) => capabilities.includes('*') || capabilities.includes(item.capability))

  useEffect(() => {
    if (!visibleTabs.some((item) => item.index === tab) && visibleTabs.length) setTab(visibleTabs[0].index)
  }, [tab, capabilities])

  useEffect(() => {
    if (tab === 0) fetchList()
    if (tab === 3 || tab === 7) listUbicaciones().then((payload) => setLocations(payload?.data?.rows || [])).catch(() => setLocations([]))
  }, [tab])

  const closeCancellation = () => {
    setCancelTarget(null)
    setCancelReason('')
    setCancelConfirmed(false)
    setCancelError('')
  }

  const submitCancellation = async (event) => {
    event.preventDefault()
    setCancelError('')
    if (cancelReason.trim().length < 5) {
      setCancelError('Escribe un motivo de al menos 5 caracteres.')
      return
    }
    if (!cancelConfirmed) {
      setCancelError('Confirma que deseas cancelar esta orden y liberar sus reservas.')
      return
    }
    const result = await cancelOrder({ order_id: cancelTarget.id, motivo: cancelReason.trim() })
    if (!result.ok) {
      setCancelError(result.message)
      return
    }
    setListToast({
      ok: true,
      msg: result.data?.duplicate
        ? 'La orden ya estaba cancelada.'
        : `OP ID ${result.data?.order_id} cancelada; se liberaron ${result.data?.released_reservations || 0} reservas.`,
    })
    closeCancellation()
  }

  return (
    <div>
      <h1 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Producción</h1>

      <div className="flex gap-1 mb-4 md:mb-6 border-b border-border overflow-x-auto pb-px scrollbar-none">
        {visibleTabs.map(({ label, index }) => (
          <button
            key={label}
            onClick={() => { setTab(index); clearError() }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === index ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <Alert msg={error} />}
      {listToast && tab === 0 && <div className="mb-4"><ToastInline toast={listToast} /></div>}

      {tab === 0 && (
        <div>
          {loading && <Spinner />}
          {!loading && list.length === 0 && <EmptyState text="Sin órdenes de producción" />}
          {list.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm min-w-[1240px]">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    {['Orden', 'Producto', 'SKU', 'Destino', 'Cant. plan.', 'Cant. real', 'Mermas', 'Lote PT', 'Fase', 'Estado', 'Fecha', 'Hora', 'Acciones'].map((c) => (
                      <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const st = STATUS_LABEL[r.status] || { label: r.status ?? empty, css: 'text-muted bg-white/5' }
                    return (
                      <tr key={r.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-mono text-xs text-foreground"><span className="block font-semibold text-primary">OP ID {r.id}</span><span className="block">{r.codigo_orden ?? empty}</span></td>
                        <td className="px-4 py-3 text-foreground">{r.product_name ?? empty}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted">{r.sku ?? empty}</td>
                        <td className="px-4 py-3 text-xs">{r.origen_tipo === 'OC_CLIENTE' ? <>{r.pedido_cliente_id && <span className="block font-semibold text-primary">PED ID {r.pedido_cliente_id}</span>}{r.referencia_cliente || 'OC'} / {r.cliente_final || '-'}</> : r.origen_tipo === 'STOCK_SEGURIDAD' ? 'Stock seguridad' : '-'}</td>
                        <td className="px-4 py-3 tabular-nums">{r.qty_planned ?? empty}</td>
                        <td className="px-4 py-3 tabular-nums">{r.qty_real ?? empty}</td>
                        <td className="px-4 py-3 text-xs">{r.mermas?.length ? r.mermas.map((merma) => (
                          <span key={merma.id} className="mb-1 block text-orange-400">
                            <span className="font-mono">{merma.numero || `MER ID ${merma.id}`}</span>: {Number(merma.cantidad)} {merma.unidad || ''} · {merma.tipo}
                            <span className="block max-w-[220px] text-muted">{merma.motivo || 'Sin motivo'}{merma.registrado_por ? ` · ${merma.registrado_por}` : ''}{merma.creado_en ? ` · ${safeDate(merma.creado_en)}` : ''}</span>
                          </span>
                        )) : empty}</td>
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{r.output_lot ?? empty}</td>
                        <td className="px-4 py-3">{r.current_phase ?? empty}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.css}`}>{st.label}</span>
                        </td>
                        <td className="px-4 py-3 text-muted text-xs">{safeDate(r.created_at)}</td>
                        <td className="px-4 py-3 text-muted text-xs">{safeTime(r.created_at)}</td>
                        <td className="px-4 py-3">
                          {canCancelOrder && r.status === 'APROBADA' ? (
                            <button
                              type="button"
                              title="Cancelar orden de producción"
                              aria-label={`Cancelar OP ID ${r.id}`}
                              onClick={() => { setListToast(null); setCancelTarget(r) }}
                              className="inline-flex h-8 w-8 items-center justify-center text-muted hover:bg-danger/10 hover:text-danger"
                            >
                              <Ban size={16} />
                            </button>
                          ) : <span className="text-muted">-</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 1 && <StartForm loading={loading} onSubmit={start} onDone={() => setTab(0)} onChooseCustomer={() => setTab(8)} />}
      {tab === 2 && <ConfirmMaterialsForm loading={loading} onSubmit={confirm} />}
      {tab === 3 && <MaterialAdjustmentForm loading={loading} onSubmit={adjustMaterials} locations={locations} />}
      {tab === 4 && <PrepareReplenishmentForm loading={loading} onSubmit={prepareReplenishment} onCancel={cancelReplenishment} />}
      {tab === 5 && <ConfirmReplenishmentForm loading={loading} onSubmit={confirmReplenishment} />}
      {tab === 6 && <AdvanceForm loading={loading} onSubmit={advance} />}
      {tab === 7 && <CloseForm loading={loading} onSubmit={close} locations={locations} />}
      {tab === 8 && <CustomerOrdersPanel canApprove={['admin', 'administrador', 'supervisor'].includes(role)} onStart={start} onReleased={fetchList} />}

      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="cancel-production-title">
          <form onSubmit={submitCancellation} className="w-full max-w-lg border border-border bg-surface shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 id="cancel-production-title" className="text-base font-semibold text-foreground">Cancelar OP ID {cancelTarget.id}</h2>
                <p className="mt-1 text-sm text-muted">{cancelTarget.codigo_orden} · {cancelTarget.product_name}</p>
                <p className="mt-2 text-sm text-muted">La orden quedará cancelada y sus materiales reservados volverán a estar disponibles. No se modificará el stock físico.</p>
              </div>
              <button type="button" onClick={closeCancellation} title="Cerrar" className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted hover:text-foreground">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <Field label="Motivo de cancelación *">
                <textarea
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  maxLength={500}
                  rows={4}
                  className="input-field resize-y"
                  placeholder="Ej. Orden duplicada o solicitud del cliente cancelada"
                  autoFocus
                  required
                />
              </Field>
              <label className="flex cursor-pointer items-start gap-3 text-sm text-foreground">
                <input type="checkbox" checked={cancelConfirmed} onChange={(event) => setCancelConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-500" />
                <span>Confirmo que deseo cancelar la orden y liberar todas sus reservas de materiales.</span>
              </label>
              {cancelError && <div role="alert" className="border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{cancelError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <button type="button" onClick={closeCancellation} disabled={loading} className="px-4 py-2 text-sm text-muted hover:text-foreground disabled:opacity-50">Volver</button>
              <button type="submit" disabled={loading || !cancelConfirmed || cancelReason.trim().length < 5} className="inline-flex items-center gap-2 bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50">
                <Ban size={15} /> {loading ? 'Cancelando...' : 'Cancelar orden'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function CustomerOrdersPanel({ canApprove, onStart, onReleased }) {
  const [drafts, setDrafts] = useState([])
  const [orders, setOrders] = useState([])
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [releaseCandidate, setReleaseCandidate] = useState(null)
  const [duplicateOrderId, setDuplicateOrderId] = useState(null)
  const [discardTarget, setDiscardTarget] = useState(null)
  const [discardReason, setDiscardReason] = useState('')

  const refresh = async () => {
    const [draftResult, orderResult] = await Promise.all([listCustomerOrderDrafts(), listCustomerOrders()])
    setDrafts(draftResult?.data?.rows || [])
    setOrders(orderResult?.data?.rows || [])
  }

  useEffect(() => {
    refresh().catch((error) => setMessage({ ok: false, msg: error.response?.data?.error || 'No fue posible cargar los pedidos de cliente.' }))
  }, [])

  const execute = async (work, success) => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await work()
      setMessage({ ok: true, msg: success(result) })
      await refresh()
      return result
    } catch (error) {
      setMessage({ ok: false, msg: error.response?.data?.error || error.message || 'No fue posible completar la acción.' })
      return null
    } finally {
      setBusy(false)
    }
  }

  const upload = async (event) => {
    event.preventDefault()
    if (!file) return
    if (file.size > 2_500_000) {
      setMessage({ ok: false, msg: 'El PDF supera 2,5 MB.' })
      return
    }
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('No fue posible leer el PDF'))
      reader.readAsDataURL(file)
    }).catch((error) => {
      setMessage({ ok: false, msg: error.message })
      return null
    })
    if (!base64) return
    const result = await execute(
      () => uploadCustomerOrderPdf({ name: file.name, type: 'application/pdf', base64 }),
      (response) => response.data?.duplicate
        ? `El PDF ya estaba registrado como borrador ID ${response.data.id}.`
        : `Borrador ID ${response.data.id} cargado. Revisa cliente, producto y cantidad antes de aprobarlo.`
    )
    if (result) setFile(null)
  }

  const release = async () => {
    if (!releaseCandidate) return
    const { order, item } = releaseCandidate
    setBusy(true)
    setMessage(null)
    try {
      const response = await onStart({
        pedido_cliente_id: order.id,
        pedido_cliente_item_id: item.id,
        qty_planned: item.cantidad_pendiente,
        confirmar_nueva_orden: Boolean(duplicateOrderId),
        id_orden_existente: duplicateOrderId || undefined,
      })
      if (!response.ok) {
        setMessage({ ok: false, msg: response.message || 'No fue posible liberar la OP.' })
      } else if (response.data?.requires_confirmation) {
        setDuplicateOrderId(response.data.order_id)
        setMessage({ ok: false, msg: `Ya existe OP ID ${response.data.order_id} con estos datos. Revisa si realmente necesitas otra antes de confirmar.` })
      } else {
        setMessage({ ok: true, msg: `OP ID ${response.data.order_id} liberada para PED ID ${order.id}.` })
        setReleaseCandidate(null)
        setDuplicateOrderId(null)
        await refresh()
        onReleased()
      }
    } catch (error) {
      setMessage({ ok: false, msg: error.response?.data?.error || error.message || 'No fue posible liberar la OP.' })
    } finally {
      setBusy(false)
    }
  }

  return <div className="space-y-6">
    {message && <ToastInline toast={message} />}
    {canApprove && <form onSubmit={upload} className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <h2 className="font-semibold text-foreground">Cargar OC de cliente</h2>
      <p className="text-sm text-muted">El PDF se guarda como borrador. No irá a recepciones ni liberará producción hasta que lo revises y apruebes.</p>
      <input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} className="block text-sm text-foreground" />
      <button type="submit" disabled={busy || !file} className="btn-primary disabled:opacity-50">{busy ? 'Procesando...' : 'Cargar PDF'}</button>
    </form>}

    <section className="space-y-3">
      <h2 className="font-semibold text-foreground">OC de cliente leídas para revisión</h2>
      {!drafts.some((draft) => ['PENDIENTE_REVISION', 'REQUIERE_CORRECCION'].includes(draft.estado)) && <p className="text-sm text-muted">No hay OC de cliente pendientes de revisión.</p>}
      {drafts.filter((draft) => ['PENDIENTE_REVISION', 'REQUIERE_CORRECCION'].includes(draft.estado)).map((draft) => <div key={draft.id} className="rounded-lg border border-border bg-surface p-4 space-y-2 text-sm">
        <div className="font-semibold text-foreground">Borrador ID {draft.id} · {draft.referencia_documento} · {draft.destinatario_nombre}</div>
        <div className="text-muted">Estado: {draft.estado} · Fecha: {safeDate(draft.fecha_documento)}</div>
        <div className="space-y-1">{draft.items?.map((item, index) => <div key={`${item.sku_extraido}-${index}`}>
          {item.sku_extraido} · {item.producto_catalogo || item.descripcion_extraida} · {Number(item.cantidad)} {item.unidad || 'und'}
        </div>)}</div>
        {!!draft.advertencias?.length && <div className="text-orange-400">{draft.advertencias.map((warning, index) => <div key={index}>{warning}</div>)}</div>}
        <div className="flex gap-3 items-center">
          {draft.archivo_id && <button type="button" className="text-primary hover:underline" onClick={() => downloadCustomerOrderPdf(draft.archivo_id, draft.archivo_nombre)}>Ver PDF</button>}
          {canApprove && draft.estado === 'PENDIENTE_REVISION' && <button type="button" disabled={busy} className="btn-primary disabled:opacity-50" onClick={() => execute(
            () => approveCustomerOrder(draft.id),
            (response) => `Pedido aprobado como PED ID ${response.data.id}. Ya puede seleccionarse para producción.`
          )}>Aprobar pedido</button>}
          {canApprove && ['PENDIENTE_REVISION', 'REQUIERE_CORRECCION'].includes(draft.estado) && <button type="button" disabled={busy} className="text-danger hover:underline" onClick={() => { setDiscardTarget(draft); setDiscardReason('') }}>Descartar borrador</button>}
        </div>
      </div>)}
    </section>

    {discardTarget && <div className="rounded-lg border border-danger/40 bg-surface p-4 space-y-3 text-sm">
      <div className="font-semibold">Descartar borrador ID {discardTarget.id}</div>
      <p className="text-muted">Esto permite volver a cargar una versión corregida de la misma OC. No modifica inventario.</p>
      <input value={discardReason} onChange={(event) => setDiscardReason(event.target.value)} maxLength={300} placeholder="Motivo (mínimo 5 caracteres)" className="input-field" />
      <div className="flex gap-3">
        <button type="button" disabled={busy || discardReason.trim().length < 5} className="btn-primary disabled:opacity-50" onClick={async () => {
          const result = await execute(() => discardCustomerOrderDraft(discardTarget.id, discardReason.trim()), () => `Borrador ID ${discardTarget.id} descartado. Puedes subir el PDF corregido.`)
          if (result) setDiscardTarget(null)
        }}>Confirmar descarte</button>
        <button type="button" disabled={busy} onClick={() => setDiscardTarget(null)} className="text-muted hover:text-foreground">Volver</button>
      </div>
    </div>}

    <section className="space-y-3">
      <h2 className="font-semibold text-foreground">Pedidos disponibles para producción</h2>
      {!orders.some((order) => order.items.some((item) => item.cantidad_pendiente > 0)) && <p className="text-sm text-muted">No hay unidades pendientes de producir.</p>}
      {orders.filter((order) => order.items.some((item) => item.cantidad_pendiente > 0)).map((order) => <div key={order.id} className="rounded-lg border border-border bg-surface p-4 space-y-2 text-sm">
        <div className="font-semibold text-primary">PED ID {order.id} · {order.cliente_nombre}</div>
        <div className="text-muted">OC: {order.referencia}</div>
        {order.items.filter((item) => item.cantidad_pendiente > 0).map((item) => <div key={item.id} className="flex flex-wrap justify-between items-center gap-2 border-t border-border pt-2">
          <span>Item ID {item.id} · {item.producto} ({item.sku}) · Pendiente: {item.cantidad_pendiente} und</span>
          <button type="button" disabled={busy} className="btn-primary disabled:opacity-50" onClick={() => { setReleaseCandidate({ order, item }); setDuplicateOrderId(null) }}>Preparar OP</button>
        </div>)}
      </div>)}
      {releaseCandidate && <div className="rounded-lg border border-primary/50 bg-primary/5 p-4 space-y-2 text-sm">
        <div className="font-semibold">Confirma antes de reservar materiales</div>
        <div>PED ID {releaseCandidate.order.id} · {releaseCandidate.order.cliente_nombre} · {releaseCandidate.item.producto} · {releaseCandidate.item.cantidad_pendiente} und</div>
        <div className="flex gap-3">
          <button type="button" disabled={busy} className="btn-primary disabled:opacity-50" onClick={release}>{duplicateOrderId ? 'Confirmar OP adicional' : 'Confirmar y liberar OP'}</button>
          <button type="button" disabled={busy} className="text-muted hover:text-foreground" onClick={() => { setReleaseCandidate(null); setDuplicateOrderId(null) }}>Volver</button>
        </div>
      </div>}
    </section>
  </div>
}


function StartForm({ loading, onSubmit, onDone, onChooseCustomer }) {
  const [form, setForm] = useState({
    product_id: '',
    qty_planned: '',
    origin_type: 'STOCK_SEGURIDAD',
    customer_reference: '',
    final_customer: '',
    notes: '',
  })
  const [toast, setToast] = useState(null)
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)
  const set = (k) => (e) => {
    setConfirmDuplicate(false)
    setForm((f) => ({ ...f, [k]: e.target.value }))
  }
  const handle = async (e) => {
    e.preventDefault()
    const res = await onSubmit({
      product_id: form.product_id.trim(),
      qty_planned: Number(form.qty_planned),
      origin_type: form.origin_type,
      customer_reference: form.customer_reference.trim() || undefined,
      final_customer: form.final_customer.trim() || undefined,
      notes: form.notes || undefined,
      confirmar_nueva_orden: Boolean(confirmDuplicate),
      id_orden_existente: confirmDuplicate || undefined,
    })
    if (res.ok) {
      if (res.data?.requires_confirmation) {
        setConfirmDuplicate(res.data.order_id)
        setToast({ msg: `Ya existe ${res.data.order_code} con los mismos datos. Vuelve a enviar solo si necesitas otra orden igual.`, ok: false })
        return
      }
      setToast({ msg: res.data?.already_released ? 'La orden adicional ya estaba liberada. No se modificó inventario.' : 'Orden liberada', ok: true })
      setTimeout(() => { setToast(null); onDone() }, 1500)
    } else {
      setToast({ msg: res.message, ok: false })
    }
  }

  return (
    <form onSubmit={handle} className="max-w-md bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      {form.origin_type === 'STOCK_SEGURIDAD' && <>
        <Field label="ID del producto *"><input value={form.product_id} onChange={set('product_id')} placeholder="ID o SKU" className="input-field" required /></Field>
        <Field label="Cantidad planificada *"><input type="number" min="1" value={form.qty_planned} onChange={set('qty_planned')} placeholder="0" className="input-field" required /></Field>
      </>}
      <Field label="Destino de la producción *">
        <select value={form.origin_type} onChange={set('origin_type')} className="input-field">
          <option value="STOCK_SEGURIDAD">Stock de seguridad</option>
          <option value="OC_CLIENTE">Orden de cliente</option>
        </select>
      </Field>
      {form.origin_type === 'OC_CLIENTE'
        ? <p className="text-sm text-muted">Elige una OC aprobada. Producto, cliente y cantidad pendiente se tomarán del pedido verificado.</p>
        : <Field label="Notas"><textarea value={form.notes} onChange={set('notes')} rows={2} className="input-field resize-none" /></Field>}
      <button type={form.origin_type === 'OC_CLIENTE' ? 'button' : 'submit'} onClick={form.origin_type === 'OC_CLIENTE' ? onChooseCustomer : undefined} disabled={loading} className="btn-primary">
        {form.origin_type === 'OC_CLIENTE' ? 'Elegir pedido de cliente' : loading ? 'Liberando...' : confirmDuplicate ? 'Liberar una orden adicional' : 'Liberar orden'}
      </button>
    </form>
  )
}

function ConfirmMaterialsForm({ loading, onSubmit }) {
  const [orderId, setOrderId] = useState('')
  const [toast, setToast] = useState(null)
  const handle = async (event) => {
    event.preventDefault()
    const result = await onSubmit({ order_id: orderId.trim() })
    setToast(result.ok
      ? { msg: result.data?.already_confirmed ? 'Los materiales ya estaban confirmados' : 'Materiales confirmados; producción iniciada', ok: true }
      : { msg: result.message, ok: false })
  }
  return (
    <form onSubmit={handle} className="max-w-md bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <Field label="Orden de producción *">
        <input value={orderId} onChange={(event) => setOrderId(event.target.value)} placeholder="OP ID 88 u OP-..." className="input-field" required />
      </Field>
      <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Confirmando...' : 'Confirmar materiales e iniciar'}</button>
    </form>
  )
}

function MaterialAdjustmentForm({ loading, onSubmit, locations }) {
  const [form, setForm] = useState({ order_id: '', sku: '', lote: '', ubicacion_id: '', cantidad: '', tipo: 'ENTREGA_ADICIONAL', motivo: '' })
  const [toast, setToast] = useState(null)
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)
  const set = (key) => (event) => {
    setConfirmDuplicate(false)
    setForm((current) => ({ ...current, [key]: event.target.value }))
  }
  const handle = async (event) => {
    event.preventDefault()
    const result = await onSubmit({
      ...form,
      ubicacion_id: Number(form.ubicacion_id),
      cantidad: Number(form.cantidad),
      confirmar_nuevo_ajuste: Boolean(confirmDuplicate),
      id_ajuste_existente: confirmDuplicate || undefined,
    })
    if (result.ok && result.data?.requires_confirmation) {
      setConfirmDuplicate(result.data.movement_id)
      setToast({ msg: 'Ya existe un movimiento igual reciente. Vuelve a enviar solo si es un ajuste nuevo.', ok: false })
      return
    }
    setToast(result.ok ? {
      msg: result.data?.already_recorded ? 'El movimiento adicional ya estaba registrado. No se modificó inventario.' : `${form.tipo} registrada`,
      ok: true,
    } : { msg: result.message, ok: false })
  }
  return (
    <form onSubmit={handle} className="max-w-xl bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Orden *"><input value={form.order_id} onChange={set('order_id')} placeholder="OP ID 88 u OP-..." className="input-field" required /></Field>
        <Field label="Tipo *"><select value={form.tipo} onChange={set('tipo')} className="input-field"><option>ENTREGA_ADICIONAL</option><option>DEVOLUCION</option></select></Field>
        <Field label="SKU de materia prima *"><input value={form.sku} onChange={set('sku')} className="input-field" required /></Field>
        <Field label="Lote *"><input value={form.lote} onChange={set('lote')} className="input-field" required /></Field>
        <Field label="Ubicación *"><select value={form.ubicacion_id} onChange={set('ubicacion_id')} className="input-field" required><option value="">Selecciona ubicación</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.bodega_codigo} / {location.codigo}</option>)}</select></Field>
        <Field label="Cantidad *"><input type="number" min="0.0001" step="any" value={form.cantidad} onChange={set('cantidad')} className="input-field" required /></Field>
      </div>
      <Field label="Motivo"><input value={form.motivo} onChange={set('motivo')} className="input-field" /></Field>
      <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Registrando...' : confirmDuplicate ? 'Registrar como movimiento nuevo' : 'Registrar movimiento'}</button>
    </form>
  )
}

function PrepareReplenishmentForm({ loading, onSubmit, onCancel }) {
  const [form, setForm] = useState({ order_id: '', cantidad_unidades: '', motivo: '', confirma_bom_completo: false })
  const [toast, setToast] = useState(null)
  const [cancelReference, setCancelReference] = useState('')
  const set = (key) => (event) => setForm((current) => ({
    ...current,
    [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
  }))
  const handle = async (event) => {
    event.preventDefault()
    const result = await onSubmit({
      ...form,
      order_id: form.order_id.trim(),
      cantidad_unidades: Number(form.cantidad_unidades),
      motivo: form.motivo.trim(),
    })
    const code = result.data?.replenishment_code
    setToast(result.ok
      ? { msg: result.data?.already_prepared ? `${code} ya estaba preparada` : `${code} preparada y enviada al alistador`, ok: true }
      : { msg: result.message, ok: false })
  }
  const handleCancel = async (event) => {
    event.preventDefault()
    const value = cancelReference.trim()
    const body = value.toUpperCase().startsWith('REP-')
      ? { codigo_reposicion: value }
      : { order_id: value }
    const result = await onCancel(body)
    setToast(result.ok
      ? { msg: result.data?.already_cancelled ? 'La reposición ya estaba cancelada' : 'Reposición cancelada; reservas liberadas', ok: true }
      : { msg: result.message, ok: false })
  }
  return (
    <div className="max-w-xl space-y-4">
      {toast && <ToastInline toast={toast} />}
      <form onSubmit={handle} className="bg-surface border border-border rounded-lg p-6 space-y-4">
        <Field label="Orden en proceso *"><input value={form.order_id} onChange={set('order_id')} placeholder="OP ID 88 u OP-..." className="input-field" required /></Field>
        <Field label="Unidades conformes faltantes *"><input type="number" min="1" step="1" value={form.cantidad_unidades} onChange={set('cantidad_unidades')} className="input-field" required /></Field>
        <Field label="Motivo *"><textarea value={form.motivo} onChange={set('motivo')} rows={2} placeholder="Ej. unidad no conforme por dano de empaque" className="input-field resize-none" required /></Field>
        <label className="flex items-start gap-3 text-sm text-foreground">
          <input type="checkbox" checked={form.confirma_bom_completo} onChange={set('confirma_bom_completo')} className="mt-1" required />
          <span>Confirmo que se debe reponer el BOM completo para estas unidades.</span>
        </label>
        <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Preparando...' : 'Reservar materiales FEFO'}</button>
      </form>
      <form onSubmit={handleCancel} className="border-t border-border pt-4 flex gap-3">
        <input value={cancelReference} onChange={(event) => setCancelReference(event.target.value)} placeholder="REP-... o ID/OP-..." className="input-field" required />
        <button type="submit" disabled={loading} className="btn-secondary whitespace-nowrap">Cancelar reposición</button>
      </form>
    </div>
  )
}

function ConfirmReplenishmentForm({ loading, onSubmit }) {
  const [reference, setReference] = useState('')
  const [toast, setToast] = useState(null)
  const handle = async (event) => {
    event.preventDefault()
    const value = reference.trim()
    const body = value.toUpperCase().startsWith('REP-')
      ? { codigo_reposicion: value }
      : { order_id: value }
    const result = await onSubmit(body)
    setToast(result.ok
      ? { msg: result.data?.already_confirmed ? 'La reposición ya estaba confirmada' : 'Reposición confirmada; materiales entregados a producción', ok: true }
      : { msg: result.message, ok: false })
  }
  return (
    <form onSubmit={handle} className="max-w-md bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <Field label="Reposición u orden *"><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="REP-... o ID/OP-..." className="input-field" required /></Field>
      <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Confirmando...' : 'Confirmar entrega adicional'}</button>
    </form>
  )
}

function AdvanceForm({ loading, onSubmit }) {
  const [form, setForm] = useState({ order_id: '', phase: 'F1' })
  const [toast, setToast] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const handle = async (e) => {
    e.preventDefault()
    const res = await onSubmit({ order_id: form.order_id.trim(), phase: form.phase })
    if (res.ok) setToast({ msg: `Orden avanzada a ${form.phase}`, ok: true })
    else setToast({ msg: res.message, ok: false })
  }

  return (
    <form onSubmit={handle} className="max-w-md bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <Field label="OP ID *"><input value={form.order_id} onChange={set('order_id')} placeholder="OP ID 88 u OP-..." className="input-field" required /></Field>
      <Field label="Fase destino *">
        <select value={form.phase} onChange={set('phase')} className="input-field">
          {PHASES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </Field>
      <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Avanzando...' : 'Avanzar fase'}</button>
    </form>
  )
}

function CloseForm({ loading, onSubmit, locations }) {
  const [form, setForm] = useState({ order_id: '', qty_real: '', qty_waste: '', waste_reason: '', ubicacion_id: '' })
  const [toast, setToast] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const handle = async (e) => {
    e.preventDefault()
    const qtyReal = Number(form.qty_real)
    const qtyWaste = Number(form.qty_waste)
    if (!Number.isFinite(qtyReal) || !Number.isFinite(qtyWaste)) {
      setToast({ msg: 'Confirma unidades conformes y merma', ok: false })
      return
    }
    if (qtyReal === 0 && qtyWaste === 0) {
      setToast({ msg: 'Debes contar y confirmar al menos unidades conformes o merma', ok: false })
      return
    }
    if (qtyWaste > 0 && !form.waste_reason.trim()) {
      setToast({ msg: 'Debes indicar el motivo de merma', ok: false })
      return
    }
    if (qtyReal > 0 && !form.ubicacion_id) {
      setToast({ msg: 'Selecciona la ubicación del producto terminado', ok: false })
      return
    }

    const res = await onSubmit({
      order_id: form.order_id.trim(),
      qty_real: qtyReal,
      qty_waste: qtyWaste,
      waste_reason: form.waste_reason.trim() || undefined,
      ubicacion_id: form.ubicacion_id ? Number(form.ubicacion_id) : undefined,
    })
    if (res.ok) setToast({ msg: 'Orden cerrada exitosamente', ok: true })
    else setToast({ msg: res.message, ok: false })
  }

  return (
    <form onSubmit={handle} className="max-w-md bg-surface border border-border rounded-lg p-6 space-y-4">
      {toast && <ToastInline toast={toast} />}
      <Field label="OP ID *"><input value={form.order_id} onChange={set('order_id')} placeholder="OP ID 88 u OP-..." className="input-field" required /></Field>
      <Field label="Unidades conformes terminadas *"><input type="number" min="0" value={form.qty_real} onChange={set('qty_real')} placeholder="0" className="input-field" required /></Field>
      <Field label="Merma / no conforme *"><input type="number" min="0" value={form.qty_waste} onChange={set('qty_waste')} placeholder="0" className="input-field" required /></Field>
      <Field label="Ubicación del producto terminado *">
        <select value={form.ubicacion_id} onChange={set('ubicacion_id')} className="input-field" required={Number(form.qty_real) > 0}>
          <option value="">Selecciona ubicación</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.bodega_codigo} / {location.codigo}</option>)}
        </select>
      </Field>
      <Field label="Motivo de merma">
        <textarea value={form.waste_reason} onChange={set('waste_reason')} rows={2} placeholder="Obligatorio si la merma es mayor a 0" className="input-field resize-none" />
      </Field>
      <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Cerrando...' : 'Cerrar orden'}</button>
    </form>
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

function Alert({ msg }) {
  return <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">{msg}</div>
}

function ToastInline({ toast }) {
  return (
    <div className={`px-4 py-3 rounded-lg border text-sm ${
      toast.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'
    }`}>{toast.msg}</div>
  )
}

function EmptyState({ text }) {
  return <div className="flex flex-col items-center justify-center py-16 text-muted"><span className="text-4xl mb-3 opacity-30">#</span><p className="text-sm">{text}</p></div>
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
}
