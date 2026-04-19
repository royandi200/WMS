import { useAuthStore } from '../store/authStore'
import { useNavigate }  from 'react-router-dom'

export default function Header({ onToggleSidebar, sidebarOpen, onOpenMobileMenu, mobileMenuOpen }) {
  const user     = useAuthStore(s => s.user)
  const logout   = useAuthStore(s => s.logout)
  const navigate = useNavigate()

  const handleLogout = () => { logout(); navigate('/login') }

  const initials = user?.nombre || user?.name
    ? (user.nombre || user.name).split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2)
    : 'U'

  return (
    <header className="flex items-center justify-between h-14 px-4 bg-surface border-b border-border flex-shrink-0">

      {/* Izquierda */}
      <div className="flex items-center gap-2">
        {/* DESKTOP: toggle sidebar */}
        <button onClick={onToggleSidebar}
          className="hidden md:flex w-8 h-8 items-center justify-center rounded text-muted hover:text-foreground hover:bg-white/5 transition-colors"
          title={sidebarOpen ? 'Colapsar menú' : 'Expandir menú'}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 4h12v1.5H2V4zm0 3h12v1.5H2V7zm0 3h12v1.5H2V10z"/>
          </svg>
        </button>

        {/* MOBILE: hamburger */}
        <button onClick={onOpenMobileMenu}
          className="flex md:hidden w-9 h-9 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-white/5 transition-colors active:scale-95">
          {mobileMenuOpen
            ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          }
        </button>

        {/* MOBILE: logo/título */}
        <span className="md:hidden text-primary font-bold text-base tracking-wide">WMS</span>
      </div>

      {/* Derecha */}
      <div className="flex items-center gap-2">
        {user && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <span className="text-primary text-[11px] font-bold">{initials}</span>
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-medium text-foreground leading-tight">{user.nombre || user.name || user.email}</p>
              <p className="text-[10px] text-muted capitalize leading-tight">{user.role || user.rol || 'usuario'}</p>
            </div>
          </div>
        )}
        <button onClick={handleLogout}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-muted hover:text-danger hover:bg-danger/10 transition-colors active:scale-95"
          title="Cerrar sesión">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16,17 21,12 16,7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span className="hidden sm:inline">Salir</span>
        </button>
      </div>
    </header>
  )
}
