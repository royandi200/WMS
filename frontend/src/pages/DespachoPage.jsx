import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, FileText, RefreshCw, X } from 'lucide-react'
import { useDispatchStore } from '../store/dispatchStore'
import { actOnSiigoInvoiceIssue, confirmDispatch, listSiigoInvoiceIssues, syncSiigoInvoices } from '../api/dispatch.api'
import { useAuthStore } from '../store/authStore'
import { openDispatchSheet } from '../utils/dispatchSheet'
import { formatBogotaDateTime } from '../utils/dateTime'
import { SortableTh, useSortableRows } from '../components/SortableTh'

const DISPATCH_COLUMNS = [['Origen', 'origen'], ['Despacho', 'id'], ['Cliente / destino', 'cliente_nombre'], ['SKU', 'sku'],
  ['Lote / ubicación', 'lote'], ['Solicitado', 'cantidad_facturada'], ['Asignado', 'asignado'], ['Reserva activa', 'reserva_activa'],
  ['Despachado', 'cantidad_despachada_total'], ['Sin asignar', 'cantidad_pendiente'], ['Estado', 'estado'], ['Fecha', 'fecha'], ['Acción', null]]
const DISPATCH_TH = 'px-2 py-2 text-left text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted'
const firstItem = (row) => (row.items?.length ? row.items[0] : row)

export default function DespachoPage() {
  const [tab, setTab] = useState(0)
  const [toast, setToast] = useState(null)
  const [workingId, setWorkingId] = useState(null)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const { loading, list, fetchList } = useDispatchStore()
  const capabilities = useAuthStore((state) => state.user?.capabilities || [])
  const canSync = capabilities.includes('*') || capabilities.includes('siigo.poll')
  const canConfirm = capabilities.includes('*') || capabilities.includes('dispatch.confirm')
  const canFixIssues = capabilities.includes('*') || capabilities.includes('siigo.sync')
  const [openIssues, setOpenIssues] = useState(0)
  const refreshIssueCount = () => listSiigoInvoiceIssues()
    .then((payload) => setOpenIssues(Number(payload?.data?.open || 0)))
    .catch(() => {})

  useEffect(() => { if (tab !== 2) fetchList({ limit: 200 }) }, [tab])
  useEffect(() => { refreshIssueCount() }, [])
  const rows = useMemo(() => list.filter((row) => tab === 0
    ? !['despachado', 'anulado'].includes(row.estado)
    : ['despachado', 'anulado'].includes(row.estado)), [list, tab])
  const notify = (message, ok) => {
    setToast({ message, ok })
    setTimeout(() => setToast(null), 5000)
  }
  const sync = async () => {
    setWorkingId('sync')
    try {
      const payload = await syncSiigoInvoices({})
      const errors = Number(payload?.errors || 0)
      notify(errors
        ? `Sincronización terminada: ${errors} factura(s) con novedad. Revisa la pestaña «Novedades SIIGO».`
        : 'Facturas sincronizadas', errors === 0)
      await fetchList({ limit: 200 })
      refreshIssueCount()
    } catch (error) {
      notify(error.response?.data?.error || 'No fue posible consultar Siigo', false)
    } finally {
      setWorkingId(null)
    }
  }
  const confirm = async (row) => {
    setWorkingId(row.id)
    try {
      await confirmDispatch({ despacho_id: row.id, source_type: row.source_type, source_id: row.source_id })
      notify(`Despacho ${row.numero} confirmado`, true)
      setConfirmTarget(null)
      await fetchList({ limit: 200 })
    } catch (error) {
      notify(error.response?.data?.error || 'No fue posible confirmar el despacho', false)
    } finally {
      setWorkingId(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 md:mb-6">
        <div>
          <h1 className="text-lg md:text-xl font-semibold text-foreground">Despachos</h1>
          <p className="text-xs text-muted mt-1">Salidas a clientes y materiales enviados a maquila 3Q.</p>
        </div>
        {canSync && (
          <button type="button" onClick={sync} disabled={workingId === 'sync'} className="btn-primary inline-flex items-center gap-2">
            <RefreshCw size={16} className={workingId === 'sync' ? 'animate-spin' : ''} /> Consultar Siigo
          </button>
        )}
      </div>
      <div className="flex gap-1 mb-4 md:mb-6 border-b border-border overflow-x-auto pb-px scrollbar-none">
        {['Pendientes', 'Histórico', 'Novedades SIIGO'].map((label, index) => (
          <button key={label} onClick={() => setTab(index)} className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === index ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'}`}>
            {label}
            {index === 2 && openIssues > 0 && <span className="rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white">{openIssues}</span>}
          </button>
        ))}
      </div>
      {toast && <div className={`mb-4 px-4 py-3 border text-sm ${toast.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'}`}>{toast.message}</div>}
      {tab === 2
        ? <SiigoIssuesPanel canRetry={canSync} canFix={canFixIssues} notify={notify} onChanged={() => { refreshIssueCount(); fetchList({ limit: 200 }) }} />
        : <DispatchTable rows={rows} loading={loading} workingId={workingId} onConfirm={setConfirmTarget} pending={tab === 0} canConfirm={canConfirm} />}
      {confirmTarget && (
        <DispatchConfirmationModal row={confirmTarget} working={workingId === confirmTarget.id} onCancel={() => setConfirmTarget(null)} onConfirm={() => confirm(confirmTarget)} />
      )}
    </div>
  )
}

function DispatchTable({ rows: unsortedRows, loading, workingId, onConfirm, pending, canConfirm }) {
  const formatDate = formatBogotaDateTime
  const { rows, sort, toggle } = useSortableRows(unsortedRows, {
    origen: (row) => (row.source_type === 'MAQUILA_3Q' ? 'Salida a 3Q' : row.siigo_invoice_name),
    id: (row) => (row.source_type === 'MAQUILA_3Q' ? `3Q-${row.source_id}` : Number(row.id)),
    sku: (row) => firstItem(row).sku,
    lote: (row) => firstItem(row).lote,
    cantidad_facturada: (row) => Number(row.cantidad_facturada),
    asignado: (row) => Number(row.cantidad_asignada ?? row.cantidad_reservada),
    reserva_activa: (row) => Number(row.reserva_activa),
    cantidad_despachada_total: (row) => Number(row.cantidad_despachada_total),
    cantidad_pendiente: (row) => Number(row.cantidad_pendiente),
    estado: (row) => row.estados_demanda || row.estado,
    fecha: (row) => { const value = row.despachado_en || row.creado_en; return value ? new Date(value).getTime() : null },
  })
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[1050px] text-[11px] xl:min-w-0 xl:table-fixed">
        <thead><tr className="bg-surface border-b border-border">
          {DISPATCH_COLUMNS.map(([label, key]) => key
            ? <SortableTh key={label} label={label} sortKey={key} sort={sort} onSort={toggle} className={DISPATCH_TH} />
            : <th key={label} className={`${DISPATCH_TH} sticky right-0 z-10 bg-surface`}>{label}</th>)}
        </tr></thead>
        <tbody>
          {loading && <tr><td colSpan={13} className="px-4 py-10 text-center text-muted">Cargando despachos...</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={13} className="px-4 py-10 text-center text-muted">{pending ? 'Sin despachos pendientes' : 'Sin despachos históricos'}</td></tr>}
          {!loading && rows.map((row, index) => {
            const ready = row.estado === 'picking' && Number(row.cantidad_pendiente || 0) <= 0
              && (row.siigo_invoice_id || row.source_type === 'MAQUILA_3Q')
            const items = row.items?.length ? row.items : [row]
            return (
              <tr key={row.id || index} className="group border-b border-border/50 align-top hover:bg-white/[0.02]">
                <td className="break-words px-2 py-2 font-mono leading-tight">{row.source_type === 'MAQUILA_3Q' ? 'Salida a 3Q' : (row.siigo_invoice_name || '-')}</td>
                <td className="px-2 py-2 font-mono leading-tight"><span className="block font-semibold text-primary">DSP ID {row.source_type === 'MAQUILA_3Q' ? `3Q-${row.source_id}` : row.id}</span><span className="block break-all">{row.numero}</span></td>
                <td className="break-words px-2 py-2 leading-tight">{row.cliente_nombre || 'Pendiente'}</td>
                <td className="space-y-2 px-2 py-2 leading-tight">{items.map((item, itemIndex) => (
                  <div key={`${item.sku || 'sku'}-${item.lote || 'lote'}-${itemIndex}`}>
                    <span className="break-all font-mono">{item.sku || '-'}</span>
                    <span className="block break-words text-muted">{item.producto_nombre || ''}</span>
                  </div>
                ))}</td>
                <td className="space-y-2 px-2 py-2 leading-tight">{items.map((item, itemIndex) => (
                  <div key={`${item.lote || 'lote'}-${itemIndex}`}>
                    <span className="break-all font-mono">{item.lote || '-'}</span>
                    <span className="block text-muted">{item.ubicacion || 'Sin ubicación'} | {item.cantidad} u.</span>
                  </div>
                ))}</td>
                <td className="px-2 py-2 tabular-nums">{row.cantidad_facturada ?? '-'}</td>
                <td className="px-2 py-2 tabular-nums">{row.cantidad_asignada ?? row.cantidad_reservada ?? '-'}</td>
                <td className="px-2 py-2 tabular-nums">{row.reserva_activa ?? '-'}</td>
                <td className="px-2 py-2 tabular-nums">{row.cantidad_despachada_total ?? '-'}</td>
                <td className={`px-2 py-2 tabular-nums ${Number(row.cantidad_pendiente) > 0 ? 'text-yellow-400' : 'text-green-400'}`}>{row.cantidad_pendiente ?? '-'}</td>
                <td className="break-words px-2 py-2 font-semibold leading-tight">{row.estados_demanda || row.estado}</td>
                <td className="px-2 py-2 leading-tight text-muted">{formatDate(row.despachado_en || row.creado_en)}</td>
                <td className="sticky right-0 z-[1] bg-surface px-2 py-2 shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.9)]">
                  <div className="flex flex-col items-start gap-2">
                    <button type="button" onClick={() => openDispatchSheet(row)} title="Abrir hoja imprimible del despacho" className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80">
                      <FileText size={14} /> Imprimir
                    </button>
                  {ready && canConfirm ? (
                    <button type="button" onClick={() => onConfirm(row)} disabled={workingId === row.id} title="Confirmar despacho físico" className="inline-flex items-center gap-1 text-[11px] text-green-400 hover:text-green-300 disabled:opacity-50">
                      <Check size={14} /> Confirmar
                    </button>
                  ) : pending ? <span className="text-xs text-muted">No disponible</span> : null}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const ISSUE_LABELS = {
  PRODUCTO_NO_SINCRONIZADO: 'Producto que existe en SIIGO pero aún no en el WMS',
  BODEGAS_MULTIPLES: 'La factura usa varias bodegas de SIIGO',
  BODEGA_NO_MAPEADA: 'La bodega de SIIGO de la factura no está habilitada en el WMS',
  COTIZACION: 'La factura no coincide con la cotización reservada',
  FACTURA_SIN_PRODUCTOS: 'La factura no tiene productos',
  OTRO: 'Error al importar',
}
const ISSUE_STATE = {
  ABIERTA: 'text-danger bg-danger/10',
  RESUELTA: 'text-green-400 bg-green-400/10',
  DESCARTADA: 'text-muted bg-white/5',
}

function SiigoIssuesPanel({ canRetry, canFix, notify, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showClosed, setShowClosed] = useState(false)
  const [working, setWorking] = useState(null)
  const [dismissTarget, setDismissTarget] = useState(null)
  const [reason, setReason] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const payload = await listSiigoInvoiceIssues(showClosed)
      setRows(payload?.data?.rows || [])
    } catch (error) {
      notify(error.response?.data?.error || 'No fue posible cargar las novedades', false)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [showClosed])

  const act = async (row, action, extra = {}) => {
    setWorking(`${row.siigo_invoice_id}:${action}`)
    try {
      const payload = await actOnSiigoInvoiceIssue({ action, invoice_id: row.siigo_invoice_id, ...extra })
      const result = payload?.data?.result
      const name = row.siigo_invoice_name || row.siigo_invoice_id
      if (action === 'dismiss') notify(`Factura ${name} descartada.`, true)
      else if (result?.status === 'error') notify(`La factura ${name} sigue con novedad: ${result.error}`, false)
      else if (result?.status === 'discarded') notify(`Factura ${name}: ${result.reason}. Se cerró la novedad.`, true)
      else notify(`Factura ${name} importada: el despacho ya está en Pendientes.`, true)
      setDismissTarget(null)
      setReason('')
      await load()
      onChanged()
    } catch (error) {
      notify(error.response?.data?.error || 'No fue posible completar la acción', false)
    } finally {
      setWorking(null)
    }
  }

  const busy = (row, action) => working === `${row.siigo_invoice_id}:${action}`

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted max-w-2xl">
          Facturas de venta de SIIGO que no se pudieron convertir en despacho. Se reintentan solas cada 10 minutos;
          corrige la causa (por ejemplo, trae el producto nuevo desde SIIGO) o reintenta de inmediato.
        </p>
        <label className="inline-flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} />
          Ver también resueltas o descartadas (últimos 7 días)
        </label>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[900px] text-sm">
          <thead><tr className="bg-surface border-b border-border">
            {['Factura', 'Fecha', 'Problema', 'Estado', 'Intentos', 'Último intento', 'Acciones'].map((label) => (
              <th key={label} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">{label}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">Cargando novedades...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">Todas las facturas de SIIGO pasaron al WMS.</td></tr>}
            {!loading && rows.map((row) => (
              <tr key={row.id} className="border-b border-border/50 align-top hover:bg-white/[0.02]">
                <td className="px-3 py-2 font-mono text-xs">{row.siigo_invoice_name || row.siigo_invoice_id}</td>
                <td className="px-3 py-2 text-xs text-muted">{String(row.fecha_factura || '').slice(0, 10) || '-'}</td>
                <td className="px-3 py-2 text-xs max-w-md">
                  <span className="block font-medium text-foreground">{ISSUE_LABELS[row.tipo] || row.tipo}</span>
                  {row.codigos?.length > 0 && <span className="block font-mono text-primary">{row.codigos.join(', ')}</span>}
                  <span className="block text-muted">{row.detalle}</span>
                  {row.nota && <span className="block text-muted">Nota: {row.nota}{row.resuelta_por_nombre ? ` · ${row.resuelta_por_nombre}` : ''}</span>}
                </td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ISSUE_STATE[row.estado] || ''}`}>{row.estado}</span></td>
                <td className="px-3 py-2 tabular-nums">{row.intentos}</td>
                <td className="px-3 py-2 text-xs text-muted">{formatBogotaDateTime(row.ultimo_intento)}</td>
                <td className="px-3 py-2">
                  {row.estado === 'ABIERTA' ? (
                    <div className="flex flex-col items-start gap-1.5 text-xs">
                      {canFix && row.tipo === 'PRODUCTO_NO_SINCRONIZADO' && (
                        <button type="button" disabled={Boolean(working)} onClick={() => act(row, 'sync_and_retry')} className="text-primary hover:underline disabled:opacity-50">
                          {busy(row, 'sync_and_retry') ? 'Trayendo de SIIGO...' : 'Traer producto de SIIGO y reintentar'}
                        </button>
                      )}
                      {canRetry && (
                        <button type="button" disabled={Boolean(working)} onClick={() => act(row, 'retry')} className="inline-flex items-center gap-1 text-foreground hover:underline disabled:opacity-50">
                          <RefreshCw size={12} className={busy(row, 'retry') ? 'animate-spin' : ''} /> Reintentar
                        </button>
                      )}
                      {canFix && (dismissTarget === row.siigo_invoice_id ? (
                        <div className="flex flex-col gap-1">
                          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo (mín. 5 caracteres)" className="input-field py-1 text-xs" />
                          <div className="flex gap-2">
                            <button type="button" disabled={reason.trim().length < 5 || Boolean(working)} onClick={() => act(row, 'dismiss', { motivo: reason.trim() })} className="text-danger hover:underline disabled:opacity-50">Confirmar descarte</button>
                            <button type="button" onClick={() => { setDismissTarget(null); setReason('') }} className="text-muted hover:underline">Volver</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" disabled={Boolean(working)} onClick={() => setDismissTarget(row.siigo_invoice_id)} className="text-muted hover:text-danger disabled:opacity-50">Descartar</button>
                      ))}
                    </div>
                  ) : <span className="text-xs text-muted">-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DispatchConfirmationModal({ row, working, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-dispatch-title">
      <div className="w-full max-w-lg border border-border bg-surface shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex gap-3"><AlertTriangle className="mt-0.5 text-yellow-400" size={20} /><div><h2 id="confirm-dispatch-title" className="font-semibold text-foreground">Confirmar salida física</h2><p className="mt-1 text-xs text-muted">Segunda confirmación obligatoria para evitar despachos involuntarios.</p></div></div>
          <button type="button" onClick={onCancel} disabled={working} className="text-muted hover:text-foreground"><X size={18} /></button>
        </header>
        <div className="space-y-3 px-5 py-5 text-sm">
          <p><span className="text-muted">Despacho:</span> <span className="font-mono font-semibold">{row.numero}</span></p>
          <p><span className="text-muted">Destino:</span> {row.source_type === 'MAQUILA_3Q' ? 'Maquila externa 3Q' : row.cliente_nombre}</p>
          <p className="border border-danger/30 bg-danger/10 px-3 py-2 text-danger">Al confirmar se descontará el inventario reservado. Esta acción no se ejecuta al cerrar este modal.</p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onCancel} disabled={working} className="px-4 py-2 text-sm text-muted hover:text-foreground">Volver</button>
          <button type="button" onClick={onConfirm} disabled={working} className="btn-primary inline-flex items-center gap-2"><Check size={16} /> {working ? 'Confirmando...' : 'Sí, confirmar salida'}</button>
        </footer>
      </div>
    </div>
  )
}
