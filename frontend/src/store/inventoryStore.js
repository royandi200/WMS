import { create } from 'zustand'
import {
  getSummary,
  getProductStock,
  getLotDetail,
  getKardex,
  getLowStock,
  getMapaBodega,
} from '../api/inventory.api'

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
  summary:         null,
  products:        [],
  lowStock:        [],
  kardex:          [],
  kardexMeta:      { page: 1, total: 0 },
  mapa:            { ubicaciones: [], bodegas: [] },
  loadingSummary:  false,
  loadingKardex:   false,
  loadingLowStock: false,
  loadingMapa:     false,
  loading:         false,
  error:           null,

  fetchSummary: async () => {
    set({ loadingSummary: true, loading: true, error: null })
    try {
      const res  = await getSummary()
      const data = unwrap(res)
      set({ summary: data, loadingSummary: false, loading: false })
    } catch (e) {
      set({ error: e.response?.data?.error || 'Error al cargar resumen', loadingSummary: false, loading: false })
    }
  },

  fetchLowStock: async () => {
    set({ loadingLowStock: true, error: null })
    try {
      const res  = await getLowStock()
      const data = unwrap(res)
      set({ lowStock: Array.isArray(data) ? data : (data?.rows ?? []), loadingLowStock: false })
    } catch (e) {
      set({ error: e.response?.data?.error || 'Error al cargar stock bajo', loadingLowStock: false })
    }
  },

  fetchKardex: async (params = {}) => {
    set({ loadingKardex: true, error: null })
    try {
      const res             = await getKardex(params)
      const { rows, total } = unwrapRows(res)
      set({ kardex: rows, kardexMeta: { page: params.page || 1, total }, loadingKardex: false })
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

  fetchMapa: async () => {
    set({ loadingMapa: true, error: null })
    try {
      const data = await getMapaBodega()
      const payload = data?.data ?? data
      set({ mapa: payload, loadingMapa: false })
    } catch (e) {
      set({ error: e.response?.data?.error || 'Error al cargar mapa', loadingMapa: false })
    }
  },

  clearError: () => set({ error: null }),
}))
