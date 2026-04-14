import { useAuthStore } from '../store/authStore'
import { LogOut, Package, Warehouse, TruckIcon, BarChart3 } from 'lucide-react'
import WmsLogo from '../components/WmsLogo'

const NAV_ITEMS = [
  { icon: BarChart3, label: 'Dashboard' },
  { icon: Package, label: 'Inventario' },
  { icon: Warehouse, label: 'Recepciones' },
  { icon: TruckIcon, label: 'Despachos' },
]

export default function DashboardPage() {
  const { usuario, logout } = useAuthStore()

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
              className="flex items-center gap-1.5 text-muted hover:text-subtle text-sm px-2 py-1 rounded transition-colors"
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-subtle text-sm">{usuario?.nombre || usuario?.email}</span>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-muted hover:text-danger text-sm transition-colors"
            aria-label="Cerrar sesión"
          >
            <LogOut size={15} />
            Salir
          </button>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <WmsLogo size={56} />
          <h1 className="text-foreground text-2xl font-semibold mt-6 mb-2">
            Bienvenido, {usuario?.nombre?.split(' ')[0] || 'usuario'}
          </h1>
          <p className="text-muted text-sm">El dashboard está en construcción.</p>
        </div>
      </main>
    </div>
  )
}
