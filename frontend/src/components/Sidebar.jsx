import { NavLink } from 'react-router-dom'

const NAV = [
  {
    group: 'Principal',
    items: [
      { to: '/',             icon: '◈', label: 'Dashboard'    },
    ],
  },
  {
    group: 'Operaciones',
    items: [
      { to: '/recepciones',  icon: '↓', label: 'Recepciones'  },
      { to: '/despachos',    icon: '↑', label: 'Despachos'    },
      { to: '/inventario',   icon: '▦', label: 'Inventario'   },
      { to: '/produccion',   icon: '⚙', label: 'Producción'   },
      { to: '/mermas',       icon: '⚠', label: 'Mermas'       },
    ],
  },
  {
    group: 'Trazabilidad',
    items: [
      { to: '/kardex',       icon: '≡', label: 'Kardex'       },
      { to: '/aprobaciones', icon: '✓', label: 'Aprobaciones' },
    ],
  },
  {
    group: 'Catálogos',
    items: [
      { to: '/productos',    icon: '⊞', label: 'Productos'    },
    ],
  },
  {
    group: 'Sistema',
    items: [
      { to: '/webhook-logs', icon: '⇌', label: 'Webhook Logs' },
    ],
  },
]

export default function Sidebar({ open, mobile = false, onClose }) {
  return (
    <aside className={`flex flex-col bg-surface border-r border-border transition-all duration-200 ${
      mobile ? 'w-64' : open ? 'w-56' : 'w-14'
    } flex-shrink-0 h-full`}>

      {/* Logo / header */}
      <div className="flex items-center gap-2 h-14 px-4 border-b border-border flex-shrink-0">
        <span className="text-primary font-bold text-lg leading-none">W</span>
        {(open || mobile) && (
          <span className="text-foreground font-semibold text-sm tracking-wide uppercase flex-1">WMS</span>
        )}
        {/* Mobile: botón cerrar */}
        {mobile && onClose && (
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-white/5 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* Navegación */}
      <nav className="flex-1 overflow-y-auto py-3">
        {NAV.map(({ group, items }) => (
          <div key={group} className="mb-2">
            {(open || mobile) && (
              <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted select-none">
                {group}
              </p>
            )}
            {items.map(({ to, icon, label }) => (
              <NavLink key={to} to={to} end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 mx-2 my-0.5 px-3 py-2.5 rounded text-sm font-medium transition-colors duration-100 ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted hover:text-foreground hover:bg-white/5'
                  }`
                }
                title={!open && !mobile ? label : undefined}
                onClick={mobile && onClose ? onClose : undefined}
              >
                <span className="text-base w-5 text-center flex-shrink-0 leading-none">{icon}</span>
                {(open || mobile) && <span className="truncate">{label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      {(open || mobile) && (
        <div className="px-4 py-3 border-t border-border">
          <p className="text-[10px] text-muted">WMS v1.0 · Kainotomia</p>
        </div>
      )}
    </aside>
  )
}
