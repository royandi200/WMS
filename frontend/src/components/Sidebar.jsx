import { NavLink } from 'react-router-dom'

const NAV = [
  {
    group: 'Principal',
    items: [
      { to: '/',            icon: '◈',  label: 'Dashboard' },
    ],
  },
  {
    group: 'Operaciones',
    items: [
      { to: '/recepciones', icon: '↓',  label: 'Recepciones' },
      { to: '/despachos',   icon: '↑',  label: 'Despachos' },
      { to: '/inventario',  icon: '▦',  label: 'Inventario' },
      { to: '/produccion',  icon: '⚙',  label: 'Producción' },
      { to: '/mermas',      icon: '⚠',  label: 'Mermas' },
    ],
  },
  {
    group: 'Trazabilidad',
    items: [
      { to: '/kardex',      icon: '≡',  label: 'Kardex' },
      { to: '/aprobaciones',icon: '✓',  label: 'Aprobaciones' },
    ],
  },
  {
    group: 'Catálogos',
    items: [
      { to: '/productos',   icon: '⊞',  label: 'Productos' },
    ],
  },
  {
    group: 'Sistema',
    items: [
      { to: '/webhook-logs',icon: '⇌',  label: 'Webhook Logs' },
    ],
  },
]

export default function Sidebar({ open }) {
  return (
    <aside
      className={`flex flex-col bg-surface border-r border-border transition-all duration-200 ${
        open ? 'w-56' : 'w-14'
      } flex-shrink-0`}
    >
      {/* Logo */}
      <div className={`flex items-center gap-2 h-14 px-4 border-b border-border flex-shrink-0`}>
        <span className="text-primary font-bold text-lg leading-none">W</span>
        {open && (
          <span className="text-foreground font-semibold text-sm tracking-wide uppercase">
            WMS
          </span>
        )}
      </div>

      {/* Navegación */}
      <nav className="flex-1 overflow-y-auto py-3">
        {NAV.map(({ group, items }) => (
          <div key={group} className="mb-2">
            {open && (
              <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted select-none">
                {group}
              </p>
            )}
            {items.map(({ to, icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 mx-2 my-0.5 px-3 py-2 rounded text-sm font-medium transition-colors duration-100 ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted hover:text-foreground hover:bg-white/5'
                  }`
                }
                title={!open ? label : undefined}
              >
                <span className="text-base w-5 text-center flex-shrink-0 leading-none">{icon}</span>
                {open && <span className="truncate">{label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer versión */}
      {open && (
        <div className="px-4 py-3 border-t border-border">
          <p className="text-[10px] text-muted">WMS v1.0 · Kainotomia</p>
        </div>
      )}
    </aside>
  )
}
