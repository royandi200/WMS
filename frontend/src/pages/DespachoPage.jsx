import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, FileText, RefreshCw, X } from 'lucide-react'
import { useDispatchStore } from '../store/dispatchStore'
import { confirmDispatch, syncSiigoInvoices } from '../api/dispatch.api'
import { useAuthStore } from '../store/authStore'
import { openDispatchSheet } from '../utils/dispatchSheet'
import { formatBogotaDateTime } from '../utils/dateTime'

export default function DespachoPage() {
  const [tab, setTab] = useState(0)
  const [toast, setToast] = useState(null)
  const [workingId, setWorkingId] = useState(null)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const { loading, list, fetchList } = useDispatchStore()
  const capabilities = useAuthStore((state) => state.user?.capabilities || [])
  const canSync = capabilities.includes('*') || capabilities.includes('siigo.poll')
  const canConfirm = capabilities.includes('*') || capabilities.includes('dispatch.confirm')

  useEffect(() => { fetchList({ limit: 200 }) }, [tab])
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
      notify(errors ? `Sincronizacion terminada con ${errors} error(es)` : 'Facturas sincronizadas', errors === 0)
      await fetchList({ limit: 200 })
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
        {['Pendientes', 'Historico'].map((label, index) => (
          <button key={label} onClick={() => setTab(index)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === index ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>
      {toast && <div className={`mb-4 px-4 py-3 border text-sm ${toast.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-danger/10 border-danger/30 text-danger'}`}>{toast.message}</div>}
      <DispatchTable rows={rows} loading={loading} workingId={workingId} onConfirm={setConfirmTarget} pending={tab === 0} canConfirm={canConfirm} />
      {confirmTarget && (
        <DispatchConfirmationModal row={confirmTarget} working={workingId === confirmTarget.id} onCancel={() => setConfirmTarget(null)} onConfirm={() => confirm(confirmTarget)} />
      )}
    </div>
  )
}

function DispatchTable({ rows, loading, workingId, onConfirm, pending, canConfirm }) {
  const formatDate = formatBogotaDateTime
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[1100px]">
        <thead><tr className="bg-surface border-b border-border">
          {['Origen', 'Despacho', 'Cliente / destino', 'SKU', 'Lote / ubicacion', 'Solicitado', 'Asignado', 'Reserva activa', 'Despachado', 'Sin asignar', 'Estado', 'Fecha', 'Accion'].map((label) => (
            <th key={label} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{label}</th>
          ))}
        </tr></thead>
        <tbody>
          {loading && <tr><td colSpan={13} className="px-4 py-10 text-center text-muted">Cargando despachos...</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={13} className="px-4 py-10 text-center text-muted">{pending ? 'Sin despachos pendientes' : 'Sin despachos historicos'}</td></tr>}
          {!loading && rows.map((row, index) => {
            const ready = row.estado === 'picking' && Number(row.cantidad_pendiente || 0) <= 0
              && (row.siigo_invoice_id || row.source_type === 'MAQUILA_3Q')
            const items = row.items?.length ? row.items : [row]
            return (
              <tr key={row.id || index} className="border-b border-border/50 hover:bg-white/[0.02] align-top">
                <td className="px-4 py-3 font-mono text-xs">{row.source_type === 'MAQUILA_3Q' ? 'Salida a 3Q' : (row.siigo_invoice_name || '-')}</td>
                <td className="px-4 py-3 font-mono text-xs"><span className="block font-semibold text-primary">DSP ID {row.source_type === 'MAQUILA_3Q' ? `3Q-${row.source_id}` : row.id}</span><span className="block">{row.numero}</span></td>
                <td className="px-4 py-3">{row.cliente_nombre || 'Pendiente'}</td>
                <td className="px-4 py-3 space-y-2">{items.map((item, itemIndex) => (
                  <div key={`${item.sku || 'sku'}-${item.lote || 'lote'}-${itemIndex}`}>
                    <span className="font-mono text-xs">{item.sku || '-'}</span>
                    <span className="block text-xs text-muted">{item.producto_nombre || ''}</span>
                  </div>
                ))}</td>
                <td className="px-4 py-3 space-y-2">{items.map((item, itemIndex) => (
                  <div key={`${item.lote || 'lote'}-${itemIndex}`}>
                    <span className="font-mono text-xs">{item.lote || '-'}</span>
                    <span className="block text-xs text-muted">{item.ubicacion || 'Sin ubicacion'} | {item.cantidad} u.</span>
                  </div>
                ))}</td>
                <td className="px-4 py-3 tabular-nums">{row.cantidad_facturada ?? '-'}</td>
                <td className="px-4 py-3 tabular-nums">{row.cantidad_asignada ?? row.cantidad_reservada ?? '-'}</td>
                <td className="px-4 py-3 tabular-nums">{row.reserva_activa ?? '-'}</td>
                <td className="px-4 py-3 tabular-nums">{row.cantidad_despachada_total ?? '-'}</td>
                <td className={`px-4 py-3 tabular-nums ${Number(row.cantidad_pendiente) > 0 ? 'text-yellow-400' : 'text-green-400'}`}>{row.cantidad_pendiente ?? '-'}</td>
                <td className="px-4 py-3"><span className="text-xs font-semibold">{row.estados_demanda || row.estado}</span></td>
                <td className="px-4 py-3 text-muted text-xs">{formatDate(row.despachado_en || row.creado_en)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => openDispatchSheet(row)} title="Abrir hoja imprimible del despacho" className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80">
                      <FileText size={15} /> Hoja
                    </button>
                  {ready && canConfirm ? (
                    <button type="button" onClick={() => onConfirm(row)} disabled={workingId === row.id} title="Confirmar despacho fisico" className="inline-flex items-center gap-2 text-sm text-green-400 hover:text-green-300 disabled:opacity-50">
                      <Check size={16} /> Confirmar
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

function DispatchConfirmationModal({ row, working, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-dispatch-title">
      <div className="w-full max-w-lg border border-border bg-surface shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex gap-3"><AlertTriangle className="mt-0.5 text-yellow-400" size={20} /><div><h2 id="confirm-dispatch-title" className="font-semibold text-foreground">Confirmar salida fisica</h2><p className="mt-1 text-xs text-muted">Segunda confirmacion obligatoria para evitar despachos involuntarios.</p></div></div>
          <button type="button" onClick={onCancel} disabled={working} className="text-muted hover:text-foreground"><X size={18} /></button>
        </header>
        <div className="space-y-3 px-5 py-5 text-sm">
          <p><span className="text-muted">Despacho:</span> <span className="font-mono font-semibold">{row.numero}</span></p>
          <p><span className="text-muted">Destino:</span> {row.source_type === 'MAQUILA_3Q' ? 'Maquila externa 3Q' : row.cliente_nombre}</p>
          <p className="border border-danger/30 bg-danger/10 px-3 py-2 text-danger">Al confirmar se descontara el inventario reservado. Esta accion no se ejecuta al cerrar este modal.</p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onCancel} disabled={working} className="px-4 py-2 text-sm text-muted hover:text-foreground">Volver</button>
          <button type="button" onClick={onConfirm} disabled={working} className="btn-primary inline-flex items-center gap-2"><Check size={16} /> {working ? 'Confirmando...' : 'Si, confirmar salida'}</button>
        </footer>
      </div>
    </div>
  )
}
