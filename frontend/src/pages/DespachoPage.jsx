import { useEffect, useMemo, useState } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import { useDispatchStore } from '../store/dispatchStore'
import { confirmDispatch, syncSiigoInvoices } from '../api/dispatch.api'
import { useAuthStore } from '../store/authStore'

export default function DespachoPage() {
  const [tab, setTab] = useState(0)
  const [toast, setToast] = useState(null)
  const [workingId, setWorkingId] = useState(null)
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
      await confirmDispatch({ despacho_id: row.id })
      notify(`Despacho ${row.numero} confirmado`, true)
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
          <p className="text-xs text-muted mt-1">Tareas generadas desde facturas de venta de Siigo.</p>
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
      <DispatchTable rows={rows} loading={loading} workingId={workingId} onConfirm={confirm} pending={tab === 0} canConfirm={canConfirm} />
    </div>
  )
}

function DispatchTable({ rows, loading, workingId, onConfirm, pending, canConfirm }) {
  const formatDate = (value) => value ? String(value).replace('T', ' ').slice(0, 16) : '-'
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[1100px]">
        <thead><tr className="bg-surface border-b border-border">
          {['Factura', 'Despacho', 'Cliente', 'SKU', 'Lote / ubicacion', 'Facturado', 'Reservado', 'Pendiente', 'Estado', 'Fecha', 'Accion'].map((label) => (
            <th key={label} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{label}</th>
          ))}
        </tr></thead>
        <tbody>
          {loading && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted">Cargando despachos...</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted">{pending ? 'Sin despachos pendientes' : 'Sin despachos historicos'}</td></tr>}
          {!loading && rows.map((row, index) => {
            const ready = row.estado === 'picking' && Number(row.cantidad_pendiente || 0) <= 0 && row.siigo_invoice_id
            const items = row.items?.length ? row.items : [row]
            return (
              <tr key={row.id || index} className="border-b border-border/50 hover:bg-white/[0.02] align-top">
                <td className="px-4 py-3 font-mono text-xs">{row.siigo_invoice_name || '-'}</td>
                <td className="px-4 py-3 font-mono text-xs">{row.numero}</td>
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
                <td className="px-4 py-3 tabular-nums">{row.cantidad_reservada ?? '-'}</td>
                <td className={`px-4 py-3 tabular-nums ${Number(row.cantidad_pendiente) > 0 ? 'text-yellow-400' : 'text-green-400'}`}>{row.cantidad_pendiente ?? '-'}</td>
                <td className="px-4 py-3"><span className="text-xs font-semibold">{row.estados_demanda || row.estado}</span></td>
                <td className="px-4 py-3 text-muted text-xs">{formatDate(row.despachado_en || row.creado_en)}</td>
                <td className="px-4 py-3">
                  {ready && canConfirm ? (
                    <button type="button" onClick={() => onConfirm(row)} disabled={workingId === row.id} title="Confirmar despacho fisico" className="inline-flex items-center gap-2 text-sm text-green-400 hover:text-green-300 disabled:opacity-50">
                      <Check size={16} /> Confirmar
                    </button>
                  ) : <span className="text-xs text-muted">{pending ? 'No disponible' : '-'}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
