import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

// Lazy pages
import { lazy, Suspense } from 'react'
const RecepcionPage    = lazy(() => import('./pages/RecepcionPage'))
const DespachoPage     = lazy(() => import('./pages/DespachoPage'))
const InventarioPage   = lazy(() => import('./pages/InventarioPage'))
const ProduccionPage   = lazy(() => import('./pages/ProduccionPage'))
const MermasPage       = lazy(() => import('./pages/MermasPage'))
const KardexPage       = lazy(() => import('./pages/KardexPage'))
const AprobacionesPage = lazy(() => import('./pages/AprobacionesPage'))
const ProductosPage    = lazy(() => import('./pages/ProductosPage'))
const WebhookLogsPage  = lazy(() => import('./pages/WebhookLogsPage'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
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
            <Route path="recepciones"    element={<Suspense fallback={<PageLoader />}><RecepcionPage /></Suspense>} />
            <Route path="despachos"      element={<Suspense fallback={<PageLoader />}><DespachoPage /></Suspense>} />
            <Route path="inventario"     element={<Suspense fallback={<PageLoader />}><InventarioPage /></Suspense>} />
            <Route path="produccion"     element={<Suspense fallback={<PageLoader />}><ProduccionPage /></Suspense>} />
            <Route path="mermas"         element={<Suspense fallback={<PageLoader />}><MermasPage /></Suspense>} />
            <Route path="kardex"         element={<Suspense fallback={<PageLoader />}><KardexPage /></Suspense>} />
            <Route path="aprobaciones"   element={<Suspense fallback={<PageLoader />}><AprobacionesPage /></Suspense>} />
            <Route path="productos"      element={<Suspense fallback={<PageLoader />}><ProductosPage /></Suspense>} />
            <Route path="webhook-logs"   element={<Suspense fallback={<PageLoader />}><WebhookLogsPage /></Suspense>} />
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
