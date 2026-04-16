import { create } from 'zustand'
import {
  getSummary,
  getProductStock,
  getLotDetail,
  getKardex,
  getLowStock,
} from '../api/inventory.api'

// api.js ya hace .then(r => r.data) → llega como { ok, data: <payload> }
// unwrap extrae el payload real
const unwrap = (res) => {
  if (res && typeof res === 'object' && 'data' in res) return res.data
  return res ?? null
}

const unwrapRows = (res) => {
  const d = unwrap(res)
  if (Array.isArray(d))       return { rows: d,      total: d.length }
  if (Array.isArray(d?.rows)) return { rows: d.rows, total: d.total ?? d.rows.length }
  return { rows: [], total: 0 }
}

export const useInventoryStore = create((set) => ({
  summary:        null,
  products:       [],
  lowStock:       [],
  kardex:         [],
  kardexMeta:     { page: 1, total: 0 },
  // Loading POR RECURSO — evita que Promise.all pise el flag compartido
  loadingSummary:  false,
  loadingKardex:   false,
  loadingLowStock: false,
  // loading global (compatibilidad con otros componentes)
  loading: false,
  error:   null,

  fetchSummary: async () => {
    set({ loadingSummary: true, loading: true, error: null })
    try {
      const res = await getSummary()
      set({ summary: unwrap(res), loadingSummary: false, loading: false })
    } catch (e) {
      set({ error: e.response?.data?.error || 'Error al cargar resumen', loadingSummary: false, loading: false })
    }
  },

  fetchLowStock: async () => {
    set({ loadingLowStock: true, error: null })
    try {
      const res = await getLowStock()
      const d   = unwrap(res)
      set({ lowStock: Array.isArray(d) ? d : (d?.rows ?? []), loadingLowStock: false })
    } catch (e) {
      set({ error: e.response?.data?.error || 'Error al cargar stock bajo', loadingLowStock: false })
    }
  },

  fetchKardex: async (params = {}) => {
    set({ loadingKardex: true, error: null })
    try {
      const res = await getKardex(params)
      const { rows, total } = unwrapRows(res)
      set({
        kardex:      rows,
        kardexMeta:  { page: params.page || 1, total },
        loadingKardex: false,
      })
    } catch (e) {
      set({ error: e.response?.data?.error || 'Error al cargar kardex', loadingKardex: false })
    }
  },

  fetchProductStock: async (id) => {
    set({ loading: true, error: null })
    try {
      const res = await getProductStock(id)
      set({ loading: false })
      return unwrap(res)
    } catch (e) {
      set({ error: e.response?.data?.error || 'Producto no encontrado', loading: false })
      return null
    }
  },

  fetchLotDetail: async (lpn) => {
    set({ loading: true, error: null })
    try {
      const res = await getLotDetail(lpn)
      set({ loading: false })
      return unwrap(res)
    } catch (e) {
      set({ error: e.response?.data?.error || 'Lote no encontrado', loading: false })
      return null
    }
  },

  clearError: () => set({ error: null }),
}))
