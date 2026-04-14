import { useAuthStore } from '../store/authStore'
import { useNavigate } from 'react-router-dom'

export default function Header({ onToggleSidebar, sidebarOpen }) {
  const user    = useAuthStore((s) => s.user)
  const logout  = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : 'U'

  return (
    <header className="flex items-center justify-between h-14 px-4 bg-surface border-b border-border flex-shrink-0">
      {/* Toggle sidebar */}
      <button
        onClick={onToggleSidebar}
        className="w-8 h-8 flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-white/5 transition-colors"
        title={sidebarOpen ? 'Colapsar menú' : 'Expandir menú'}
        aria-label="Toggle sidebar"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          {sidebarOpen
            ? <path d="M2 4h12v1.5H2V4zm0 3h12v1.5H2V7zm0 3h12v1.5H2V10z" />
            : <path d="M2 4h12v1.5H2V4zm0 3h12v1.5H2V7zm0 3h12v1.5H2V10z" />}
        </svg>
      </button>

      {/* Right: usuario + logout */}
      <div className="flex items-center gap-3">
        {user && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-primary text-[11px] font-bold">{initials}</span>
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-medium text-foreground leading-tight">{user.name || user.email}</p>
              <p className="text-[10px] text-muted capitalize leading-tight">{user.role || 'usuario'}</p>
            </div>
          </div>
        )}

        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-muted hover:text-danger hover:bg-danger/10 transition-colors"
          title="Cerrar sesión"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16,17 21,12 16,7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className="hidden sm:inline">Salir</span>
        </button>
      </div>
    </header>
  )
}
