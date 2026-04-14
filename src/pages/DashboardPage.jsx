import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useInventoryStore }  from '../store/inventoryStore'
import { useApprovalsStore }  from '../store/approvalsStore'

export default function DashboardPage() {
  const { summary, lowStock, loading: invLoading, fetchSummary, fetchLowStock } = useInventoryStore()
  const { list: pendingList, loading: apLoading, fetchList } = useApprovalsStore()

  useEffect(() => {
    fetchSummary()
    fetchLowStock()
    fetchList()
  }, [])

  // Totales derivados del resumen
  const totalProducts = Array.isArray(summary) ? summary.length : 0
  const totalStock    = Array.isArray(summary)
    ? summary.reduce((acc, p) => acc + (p.stock?.disponible_neto ?? 0), 0)
    : null

  const kpis = [
    {
      label:   'Productos activos',
      value:   invLoading ? '…' : totalProducts,
      color:   'text-primary',
      icon:    '▦',
      href:    '/productos',
    },
    {
      label:   'Unidades en stock',
      value:   invLoading ? '…' : (totalStock !== null ? totalStock.toLocaleString('es-CO', { maximumFractionDigits: 0 }) : '—'),
      color:   'text-green-400',
      icon:    '↓',
      href:    '/inventario',
    },
    {
      label:   'Bajo mínimo',
      value:   invLoading ? '…' : lowStock.length,
      color:   lowStock.length > 0 ? 'text-danger' : 'text-muted',
      icon:    '⚠',
      href:    '/inventario',
    },
    {
      label:   'Aprobaciones pend.',
      value:   apLoading ? '…' : pendingList.length,
      color:   pendingList.length > 0 ? 'text-yellow-400' : 'text-muted',
      icon:    '✓',
      href:    '/aprobaciones',
    },
  ]

  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground mb-6">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((c) => (
          <Link key={c.label} to={c.href}
            className="bg-surface border border-border rounded-lg p-4 hover:border-primary/40 transition-colors group">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted font-medium group-hover:text-foreground transition-colors">{c.label}</p>
              <span className={`text-lg ${c.color}`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold tabular-nums ${c.color}`}>{c.value}</p>
          </Link>
        ))}
      </div>

      {/* Alertas de stock bajo */}
      {lowStock.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">⚠ Alertas de stock</h2>
            <Link to="/inventario" className="text-xs text-primary hover:underline">Ver todo →</Link>
          </div>
          <div className="space-y-2">
            {lowStock.slice(0, 5).map((item, i) => (
              <div key={i} className="bg-surface border border-danger/20 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-mono text-primary">{item.product?.sku || item.sku}</p>
                  <p className="text-xs text-muted">{item.product?.name || item.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold tabular-nums text-danger">
                    {item.disponible_neto ?? item.stock_actual} {item.product?.unit || item.unit}
                  </p>
                  <p className="text-xs text-muted">
                    mín {item.min_stock} · déficit <span className="text-danger font-semibold">{item.deficit ?? '—'}</span>
                  </p>
                </div>
              </div>
            ))}
            {lowStock.length > 5 && (
              <p className="text-xs text-muted text-center py-1">+{lowStock.length - 5} alertas más</p>
            )}
          </div>
        </div>
      )}

      {/* Aprobaciones pendientes */}
      {pendingList.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Aprobaciones pendientes</h2>
            <Link to="/aprobaciones" className="text-xs text-primary hover:underline">Gestionar →</Link>
          </div>
          <div className="space-y-2">
            {pendingList.slice(0, 3).map((item) => (
              <div key={item.id} className="bg-surface border border-yellow-400/20 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-foreground">{item.description || `Solicitud #${item.id?.slice(0,8)}`}</p>
                  {item.from_phone && <p className="text-xs text-muted">📱 {item.from_phone}</p>}
                </div>
                <span className="text-xs bg-yellow-400/10 text-yellow-400 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                  {item.type?.replace(/_/g,' ')}
                </span>
              </div>
            ))}
            {pendingList.length > 3 && (
              <p className="text-xs text-muted text-center py-1">+{pendingList.length - 3} más pendientes</p>
            )}
          </div>
        </div>
      )}

      {/* Estado vacío feliz */}
      {!invLoading && !apLoading && lowStock.length === 0 && pendingList.length === 0 && (
        <div className="bg-surface border border-border rounded-lg px-6 py-10 text-center">
          <p className="text-3xl mb-2">✓</p>
          <p className="text-sm font-medium text-foreground">Todo en orden</p>
          <p className="text-xs text-muted mt-1">Sin alertas de stock ni aprobaciones pendientes</p>
        </div>
      )}
    </div>
  )
}
