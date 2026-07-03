import { useEffect, useState } from 'react'
import client from '../api/client'

export default function DevolucionesPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    client.get('/returns', { params: { limit: 100 } })
      .then((res) => {
        if (!alive) return
        setRows(res.data?.data?.rows || [])
        setError(null)
      })
      .catch((e) => {
        if (!alive) return
        setError(e.response?.data?.error || 'Error al cargar devoluciones')
      })
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  return (
    <div>
      <h1 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Devoluciones</h1>
      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">{error}</div>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="bg-surface border-b border-border">
              {['Devolucion', 'Fecha', 'Cliente', 'SKU', 'Producto', 'Lote', 'Cantidad', 'Estado', 'Usuario'].map((c) => (
                <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">Cargando devoluciones...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">Sin devoluciones registradas</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-mono text-xs">{r.numero}</td>
                <td className="px-4 py-3 text-muted text-xs">{formatDate(r.creado_en)}</td>
                <td className="px-4 py-3">{r.cliente_origen || '-'}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.sku || '-'}</td>
                <td className="px-4 py-3">{r.producto_nombre || '-'}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.lote || '-'}</td>
                <td className="px-4 py-3 tabular-nums">{r.cantidad ?? '-'}</td>
                <td className="px-4 py-3"><StatusBadge value={r.estado} /></td>
                <td className="px-4 py-3">{r.usuario_nombre || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${css}`}>{status}</span>
}

function formatDate(value) {
  return value ? String(value).replace('T', ' ').slice(0, 16) : '-'
}
