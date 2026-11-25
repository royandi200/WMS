import { useEffect, useState } from 'react'
import client from '../api/client'

const ESTADOS = {
  DIFERENCIA: { label: 'Diferencia', cls: 'bg-red-100 text-red-700' },
  REVISAR: { label: 'Revisar en SIIGO', cls: 'bg-amber-100 text-amber-700' },
  NO_EN_SIIGO: { label: 'No está en SIIGO', cls: 'bg-gray-100 text-gray-700' },
  OK: { label: 'Cuadra', cls: 'bg-green-100 text-green-700' },
}

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CO'))

export default function ComparacionSiigo() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [soloDiferencias, setSoloDiferencias] = useState(true)

  useEffect(() => {
    client.get('/siigo/stock-comparison')
      .then((r) => setData(r.data.data))
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false))
  }, [])

  const comparar = async () => {
    setRunning(true); setError('')
    try {
      const r = await client.post('/siigo/stock-comparison', {}, { timeout: 120000 })
      setData(r.data.data)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setRunning(false)
    }
  }

  const filas = (data?.filas || []).filter((f) => !soloDiferencias || f.estado !== 'OK')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={comparar} disabled={running}
          className="px-4 py-2 rounded-md bg-primary text-white text-sm font-medium disabled:opacity-50">
          {running ? 'Comparando…' : 'Comparar con SIIGO ahora'}
        </button>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={soloDiferencias} onChange={(e) => setSoloDiferencias(e.target.checked)} />
          Ver solo lo que no cuadra
        </label>
        {data && (
          <span className="text-xs text-muted">
            Última comparación: {new Date(data.creado_en).toLocaleString('es-CO')} ({data.origen === 'AUTOMATICA' ? 'automática diaria' : 'manual'})
          </span>
        )}
      </div>

      <p className="text-xs text-muted">
        Solo lee saldos de SIIGO, no cambia nada allá. Se ejecuta sola cada mañana.
        Lo facturado en SIIGO que aún no se despacha no cuenta como diferencia.
      </p>

      {error && (
        <div className="flex items-start justify-between gap-3 p-3 rounded-md bg-red-50 text-red-700 text-sm">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Cerrar" className="font-bold">×</button>
        </div>
      )}

      {loading && <p className="text-sm text-muted">Cargando…</p>}
      {!loading && !data && !error && <p className="text-sm text-muted">Aún no hay comparaciones. Usa «Comparar con SIIGO ahora».</p>}

      {data && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="px-3 py-1 rounded bg-green-100 text-green-700">Cuadran: {data.resumen.ok}</span>
            <span className="px-3 py-1 rounded bg-red-100 text-red-700">Con diferencia: {data.resumen.con_diferencia}</span>
            <span className="px-3 py-1 rounded bg-amber-100 text-amber-700">Revisar en SIIGO: {data.resumen.revisar}</span>
            <span className="px-3 py-1 rounded bg-gray-100 text-gray-700">No están en SIIGO: {data.resumen.no_en_siigo}</span>
          </div>

          <div className="overflow-x-auto border border-border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-muted">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">WMS</th>
                  <th className="px-3 py-2 text-right">SIIGO</th>
                  <th className="px-3 py-2 text-right">Facturado sin despachar</th>
                  <th className="px-3 py-2 text-right">Diferencia</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Nota</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.sku} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-mono text-xs">{f.sku}</td>
                    <td className="px-3 py-2">{f.nombre}</td>
                    <td className="px-3 py-2 text-right">{fmt(f.saldo_wms)}</td>
                    <td className="px-3 py-2 text-right" title={(f.bodegas_siigo || []).map((b) => `${b.nombre}: ${b.cantidad}`).join('\n')}>{fmt(f.saldo_siigo)}</td>
                    <td className="px-3 py-2 text-right">{fmt(f.facturado_pendiente)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmt(f.diferencia)}</td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs ${ESTADOS[f.estado].cls}`}>{ESTADOS[f.estado].label}</span></td>
                    <td className="px-3 py-2 text-xs text-muted">{f.nota}</td>
                  </tr>
                ))}
                {!filas.length && (
                  <tr><td colSpan={8} className="px-3 py-4 text-center text-muted">Todo cuadra.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
