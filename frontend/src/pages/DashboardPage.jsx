import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { LogOut, Package, Warehouse, TruckIcon, BarChart3 } from 'lucide-react'
import WmsLogo from '../components/WmsLogo'

const NAV_ITEMS = [
  { icon: BarChart3,  label: 'Dashboard',   to: '/' },
  { icon: Package,    label: 'Inventario',  to: '/inventario' },
  { icon: Warehouse,  label: 'Recepciones', to: '/recepciones' },
  { icon: TruckIcon,  label: 'Despachos',   to: '/despachos' },
]

export default function DashboardPage() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-14 bg-surface border-b border-border flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <WmsLogo size={28} />
          <span className="text-foreground font-semibold text-sm">WMS</span>
          <span className="text-border">|</span>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.label}
              onClick={() => navigate(item.to)}
              className="flex items-center gap-1.5 text-muted hover:text-foreground text-sm px-2 py-1 rounded transition-colors"
            >
              <item.icon size={14} />{item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-subtle text-sm">{user?.nombre || user?.email}</span>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-muted hover:text-danger text-sm transition-colors"
            aria-label="Cerrar sesión"
          >
            <LogOut size={15} />Salir
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <WmsLogo size={56} />
          <h1 className="text-foreground text-2xl font-semibold mt-6 mb-2">
            Bienvenido, {user?.nombre?.split(' ')[0] || 'usuario'}
          </h1>
          <p className="text-muted text-sm mb-8">Selecciona un módulo para comenzar.</p>
          <div className="flex gap-3 justify-center flex-wrap">
            {NAV_ITEMS.filter(i => i.to !== '/').map((item) => (
              <button
                key={item.to}
                onClick={() => navigate(item.to)}
                className="flex items-center gap-2 px-4 py-2.5 bg-surface border border-border rounded-lg text-sm text-muted hover:text-foreground hover:border-primary/40 transition-all"
              >
                <item.icon size={15} />{item.label}
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
