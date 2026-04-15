import { create } from 'zustand'
import {
  getSummary,
  getProductStock,
  getLotDetail,
  getKardex,
  getLowStock,
} from '../api/inventory.api'

// Backend retorna: { ok, data: { rows, total } } o { ok, data: {...} }
// Axios envuelve en response.data → res.data = { ok, data: ... }
const unwrap      = (res) => res.data?.data ?? res.data ?? null
const unwrapRows  = (res) => {
  const d = res.data?.data ?? res.data
  if (Array.isArray(d))        return { rows: d, total: d.length }
  if (Array.isArray(d?.rows))  return { rows: d.rows, total: d.total ?? d.rows.length }
  if (Array.isArray(d?.data?.rows)) return { rows: d.data.rows, total: d.data.total ?? 0 }
  return { rows: [], total: 0 }
}

export const useInventoryStore = create((set) => ({
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
      set({ summary: unwrap(res), loading: false })
    } catch (e) {
      set({ error: e.response?.data?.error || 'Error al cargar resumen', loading: false })
    }
  },

  fetchLowStock: async () => {
    set({ loading: true, error: null })
    try {
      const res = await getLowStock()
      const d   = unwrap(res)
      set({ lowStock: Array.isArray(d) ? d : (d?.rows ?? []), loading: false })
    } catch (e) {
      set({ error: e.response?.data?.error || 'Error al cargar stock bajo', loading: false })
    }
  },

  fetchKardex: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      const res = await getKardex(params)
      const { rows, total } = unwrapRows(res)
      set({
        kardex:     rows,
        kardexMeta: { page: params.page || 1, total },
        loading:    false,
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
