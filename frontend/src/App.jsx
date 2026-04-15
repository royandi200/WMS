import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Component, lazy, Suspense } from 'react'
import { useAuthStore } from './store/authStore'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

// ProductosPage: import directo (no lazy) para evitar crash silencioso de chunk
import ProductosPage from './pages/ProductosPage'

// Resto: lazy
const RecepcionPage    = lazy(() => import('./pages/RecepcionPage'))
const DespachoPage     = lazy(() => import('./pages/DespachoPage'))
const InventarioPage   = lazy(() => import('./pages/InventarioPage'))
const ProduccionPage   = lazy(() => import('./pages/ProduccionPage'))
const MermasPage       = lazy(() => import('./pages/MermasPage'))
const KardexPage       = lazy(() => import('./pages/KardexPage'))
const AprobacionesPage = lazy(() => import('./pages/AprobacionesPage'))
const WebhookLogsPage  = lazy(() => import('./pages/WebhookLogsPage'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// ErrorBoundary global: captura errores de render y muestra mensaje en lugar de pantalla en blanco
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
          <span className="text-4xl">⚠️</span>
          <p className="text-foreground font-semibold">Error al cargar esta página</p>
          <p className="text-muted text-sm max-w-sm">{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary/80 transition-colors"
          >
            Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
        />

        {/* Protected — todas dentro del Layout */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="recepciones"  element={<ErrorBoundary><Suspense fallback={<PageLoader />}><RecepcionPage /></Suspense></ErrorBoundary>} />
            <Route path="despachos"    element={<ErrorBoundary><Suspense fallback={<PageLoader />}><DespachoPage /></Suspense></ErrorBoundary>} />
            <Route path="inventario"   element={<ErrorBoundary><Suspense fallback={<PageLoader />}><InventarioPage /></Suspense></ErrorBoundary>} />
            <Route path="produccion"   element={<ErrorBoundary><Suspense fallback={<PageLoader />}><ProduccionPage /></Suspense></ErrorBoundary>} />
            <Route path="mermas"       element={<ErrorBoundary><Suspense fallback={<PageLoader />}><MermasPage /></Suspense></ErrorBoundary>} />
            <Route path="kardex"       element={<ErrorBoundary><Suspense fallback={<PageLoader />}><KardexPage /></Suspense></ErrorBoundary>} />
            <Route path="aprobaciones" element={<ErrorBoundary><Suspense fallback={<PageLoader />}><AprobacionesPage /></Suspense></ErrorBoundary>} />
            <Route path="productos"    element={<ErrorBoundary><ProductosPage /></ErrorBoundary>} />
            <Route path="webhook-logs" element={<ErrorBoundary><Suspense fallback={<PageLoader />}><WebhookLogsPage /></Suspense></ErrorBoundary>} />
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
