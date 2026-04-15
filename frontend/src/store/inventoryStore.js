import { create } from 'zustand'
import {
  getSummary,
  getProductStock,
  getLotDetail,
  getKardex,
  getLowStock,
} from '../api/inventory.api'

export const useInventoryStore = create((set, get) => ({
  summary:    null,
  products:   [],
  lowStock:   [],
  kardex:     [],
  kardexMeta: { page: 1, total: 0 },
  loading:    false,
  error:      null,

  fetchSummary: async () => {
    set({ loading: true, error: null })
    try {
      const res = await getSummary()
      set({ summary: res.data, loading: false })
    } catch (e) {
      set({ error: e.response?.data?.error || 'Error al cargar resumen', loading: false })
    }
  },

  fetchLowStock: async () => {
    set({ loading: true, error: null })
    try {
      const res = await getLowStock()
      set({ lowStock: res.data || [], loading: false })
    } catch (e) {
      set({ error: e.response?.data?.error || 'Error al cargar stock bajo', loading: false })
    }
  },

  fetchKardex: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      const res = await getKardex(params)
      set({
        kardex:     res.data?.rows || res.data || [],
        kardexMeta: { page: params.page || 1, total: res.data?.total || 0 },
        loading: false,
      })
    } catch (e) {
      set({ error: e.response?.data?.error || 'Error al cargar kardex', loading: false })
    }
  },

  fetchProductStock: async (id) => {
    set({ loading: true, error: null })
    try {
      const res = await getProductStock(id)
      set({ loading: false })
      return res.data
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
      return res.data
    } catch (e) {
      set({ error: e.response?.data?.error || 'Lote no encontrado', loading: false })
      return null
    }
  },

  clearError: () => set({ error: null }),
}))
