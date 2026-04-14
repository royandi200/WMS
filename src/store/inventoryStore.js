import { create } from 'zustand'
import {
  getSummary,
  getProductStock,
  getLotDetail,
  getKardex,
  getLowStock,
} from '../api/inventory.api'

export const useInventoryStore = create((set, get) => ({
  // Estado
  summary:    null,
  products:   [],
  lowStock:   [],
  kardex:     [],
  kardexMeta: { page: 1, total: 0 },
  loading:    false,
  error:      null,

  // Acciones
  fetchSummary: async () => {
    set({ loading: true, error: null })
    try {
      const data = await getSummary()
      set({ summary: data, loading: false })
    } catch (e) {
      set({ error: e.response?.data?.message || 'Error al cargar resumen', loading: false })
    }
  },

  fetchLowStock: async () => {
    set({ loading: true, error: null })
    try {
      const data = await getLowStock()
      set({ lowStock: data, loading: false })
    } catch (e) {
      set({ error: e.response?.data?.message || 'Error al cargar stock bajo', loading: false })
    }
  },

  fetchKardex: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      const data = await getKardex(params)
      set({
        kardex:     data.rows  || data,
        kardexMeta: { page: params.page || 1, total: data.total || 0 },
        loading: false,
      })
    } catch (e) {
      set({ error: e.response?.data?.message || 'Error al cargar kardex', loading: false })
    }
  },

  fetchProductStock: async (id) => {
    set({ loading: true, error: null })
    try {
      const data = await getProductStock(id)
      set({ loading: false })
      return data
    } catch (e) {
      set({ error: e.response?.data?.message || 'Producto no encontrado', loading: false })
      return null
    }
  },

  fetchLotDetail: async (lpn) => {
    set({ loading: true, error: null })
    try {
      const data = await getLotDetail(lpn)
      set({ loading: false })
      return data
    } catch (e) {
      set({ error: e.response?.data?.message || 'Lote no encontrado', loading: false })
      return null
    }
  },

  clearError: () => set({ error: null }),
}))
