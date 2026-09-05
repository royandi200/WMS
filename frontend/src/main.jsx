import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

const CHUNK_RECOVERY_PREFIX = 'wms:chunk-recovery:'

window.addEventListener('vite:preloadError', (event) => {
  const detail = String(event?.payload?.message || event?.payload || 'unknown-chunk')
  const key = `${CHUNK_RECOVERY_PREFIX}${detail.slice(0, 180)}`
  if (!sessionStorage.getItem(key)) {
    event.preventDefault()
    sessionStorage.setItem(key, new Date().toISOString())
    window.location.reload()
  }
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 1000 * 60 * 5 },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
