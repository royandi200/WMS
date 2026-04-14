export default function DashboardPage() {
  const cards = [
    { label: 'Stock total',       value: '—',  color: 'text-primary',  icon: '▦' },
    { label: 'Recepciones hoy',   value: '—',  color: 'text-green-400', icon: '↓' },
    { label: 'Despachos hoy',     value: '—',  color: 'text-blue-400',  icon: '↑' },
    { label: 'Aprobaciones pend.', value: '—', color: 'text-yellow-400',icon: '✓' },
  ]

  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground mb-6">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="bg-surface border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted font-medium">{c.label}</p>
              <span className={`text-lg ${c.color}`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold tabular-nums ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Placeholder actividad reciente */}
      <div className="bg-surface border border-border rounded-lg p-6">
        <h2 className="text-sm font-semibold text-foreground mb-4">Actividad reciente</h2>
        <p className="text-sm text-muted">Los módulos se están construyendo — aquí aparecerá el resumen de movimientos del día.</p>
      </div>
    </div>
  )
}
