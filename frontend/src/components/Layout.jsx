import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'

export default function Layout() {
  const [sidebarOpen,   setSidebarOpen]   = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  // Cierra el menú mobile al navegar
  useEffect(() => { setMobileMenuOpen(false) }, [location.pathname])

  return (
    <div className="flex h-screen bg-background overflow-hidden">

      {/* ── DESKTOP: sidebar lateral ── */}
      <div className="hidden md:flex">
        <Sidebar open={sidebarOpen} />
      </div>

      {/* ── MOBILE: drawer overlay ── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          {/* Drawer */}
          <div className="relative z-10 flex flex-col bg-surface border-r border-border w-64 h-full shadow-2xl"
            style={{animation:'slideInLeft .2s ease'}}>
            <Sidebar open={true} onClose={() => setMobileMenuOpen(false)} mobile />
          </div>
        </div>
      )}

      {/* ── Contenido principal ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header
          onToggleSidebar={() => setSidebarOpen(v => !v)}
          sidebarOpen={sidebarOpen}
          onOpenMobileMenu={() => setMobileMenuOpen(v => !v)}
          mobileMenuOpen={mobileMenuOpen}
        />

        {/* main: en mobile añade padding bottom para el bottom nav */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
          <Outlet />
        </main>
      </div>

      {/* ── MOBILE: bottom navigation ── */}
      <BottomNav />

      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%) }
          to   { transform: translateX(0) }
        }
      `}</style>
    </div>
  )
}
