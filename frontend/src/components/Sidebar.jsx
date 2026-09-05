import { NavLink } from 'react-router-dom'
import {
  Bell, Boxes, ClipboardCheck, ClipboardList, Factory, FileClock, LayoutDashboard,
  PackageCheck, PackageOpen, PackageSearch, RefreshCcw, RotateCcw, Settings2, Trash2,
  Truck, Users, X,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'

const NAV = [
  { group: 'Principal', items: [{ to: '/', icon: LayoutDashboard, label: 'Dashboard', capability: 'dashboard.view' }] },
  { group: 'Operaciones', items: [
    { to: '/recepciones', icon: PackageCheck, label: 'Recepciones', capability: 'reception.read' },
    { to: '/despachos', icon: Truck, label: 'Despachos', capability: 'dispatch.read' },
    { to: '/devoluciones', icon: RotateCcw, label: 'Devoluciones', capability: 'returns.read' },
    { to: '/inventario', icon: Boxes, label: 'Inventario', capability: 'inventory.read' },
    { to: '/produccion', icon: Factory, label: 'Produccion', capability: 'production.read' },
    { to: '/maquila', icon: PackageOpen, label: 'Maquila 3Q', capability: 'outsourcing.read' },
    { to: '/mermas', icon: Trash2, label: 'Mermas', capability: 'waste.read' },
  ] },
  { group: 'Trazabilidad', items: [
    { to: '/kardex', icon: FileClock, label: 'Kardex', capability: 'inventory.read' },
    { to: '/aprobaciones', icon: ClipboardCheck, label: 'Aprobaciones', capability: 'approvals.read' },
  ] },
  { group: 'Catalogos', items: [{ to: '/productos', icon: PackageSearch, label: 'Productos', capability: 'catalog.read' }] },
  { group: 'Sistema', items: [
    { to: '/usuarios', icon: Users, label: 'Usuarios', capability: 'users.manage' },
    { to: '/configuracion-alertas', icon: Settings2, label: 'Configurar alertas', capability: 'alert_settings.manage', adminOnly: true },
    { to: '/notificaciones', icon: Bell, label: 'Notificaciones', capability: 'webhook.logs.read' },
    { to: '/webhook-logs', icon: RefreshCcw, label: 'Webhook Logs', capability: 'webhook.logs.read' },
  ] },
]

export default function Sidebar({ open, mobile = false, onClose }) {
  const user = useAuthStore((state) => state.user)
  const capabilities = user?.capabilities || []
  const legacyAdmin = ['admin', 'supervisor'].includes(String(user?.rol || '').toLowerCase())
  const allowed = (item) => {
    if (item.adminOnly && !['admin', 'administrador'].includes(String(user?.rol || '').toLowerCase())) return false
    return legacyAdmin || capabilities.includes('*') || capabilities.includes(item.capability)
  }
  return (
    <aside className={`flex flex-col bg-surface border-r border-border transition-all duration-200 ${mobile ? 'w-64' : open ? 'w-56' : 'w-14'} flex-shrink-0 h-full`}>
      <div className="flex items-center gap-2 h-14 px-4 border-b border-border flex-shrink-0">
        <ClipboardList size={20} className="text-primary flex-shrink-0" />
        {(open || mobile) && <span className="text-foreground font-semibold text-sm uppercase flex-1">WMS</span>}
        {mobile && onClose && <button onClick={onClose} title="Cerrar menu" className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-white/5"><X size={17} /></button>}
      </div>
      <nav className="flex-1 overflow-y-auto py-3">
        {NAV.map(({ group, items }) => {
          const visible = items.filter(allowed)
          if (!visible.length) return null
          return <div key={group} className="mb-2">
            {(open || mobile) && <p className="px-4 py-1 text-[10px] font-semibold uppercase text-muted select-none">{group}</p>}
            {visible.map(({ to, icon: Icon, label }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex items-center gap-3 mx-2 my-0.5 px-3 py-2.5 text-sm font-medium transition-colors duration-100 ${isActive ? 'bg-primary/10 text-primary' : 'text-muted hover:text-foreground hover:bg-white/5'}`} title={!open && !mobile ? label : undefined} onClick={mobile && onClose ? onClose : undefined}>
              <Icon size={18} className="w-5 flex-shrink-0" />
              {(open || mobile) && <span className="truncate">{label}</span>}
            </NavLink>)}
          </div>
        })}
      </nav>
      {(open || mobile) && <div className="px-4 py-3 border-t border-border"><p className="text-[10px] text-muted">WMS v1.0 - Kainotomia</p></div>}
    </aside>
  )
}
