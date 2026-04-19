import { NavLink } from 'react-router-dom'

const MAIN_NAV = [
  { to: '/',             icon: '◈', label: 'Dashboard'   },
  { to: '/recepciones',  icon: '↓', label: 'Recepciones' },
  { to: '/inventario',   icon: '▦', label: 'Inventario'  },
  { to: '/produccion',   icon: '⚙', label: 'Producción'  },
  { to: '/aprobaciones', icon: '✓', label: 'Aprobac.'    },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-surface border-t border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-center justify-around h-14">
        {MAIN_NAV.map(({ to, icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors active:scale-95 ${
                isActive ? 'text-primary' : 'text-muted'
              }`
            }>
            {({ isActive }) => (
              <>
                <span className={`text-lg leading-none transition-transform ${isActive ? 'scale-110' : ''}`}>
                  {icon}
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-wide leading-none">{label}</span>
                {isActive && (
                  <div className="absolute bottom-0 w-8 h-0.5 rounded-full bg-primary"
                    style={{position:'relative',marginTop:'2px'}}/>
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
