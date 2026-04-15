import { create } from 'zustand'
import * as api from '../api/products.api'

// El backend retorna: { ok, data: { rows: [...], total: N } }
// Axios envuelve en response.data, entonces:
//   const { data } = await api.getProducts()  →  data = { ok, data: { rows, total } }
//   data.data.rows  es el array correcto
const extractRows = (axiosData) => {
  // Soporta: { data: { rows } }, { rows }, o array directo
  if (Array.isArray(axiosData))           return axiosData
  if (Array.isArray(axiosData?.rows))     return axiosData.rows
  if (Array.isArray(axiosData?.data?.rows)) return axiosData.data.rows
  if (Array.isArray(axiosData?.data))     return axiosData.data
  return []
}

const extractOne = (axiosData) => {
  // Soporta: { data: {...} } o el objeto directo
  if (axiosData?.data && !Array.isArray(axiosData.data)) return axiosData.data
  return axiosData
}

export const useProductsStore = create((set, get) => ({
  list:    [],
  total:   0,
  detail:  null,
  loading: false,
  error:   null,
  filters: { search: '', type: '', active: 'true', page: 1 },

  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  clearError: () => set({ error: null }),

  fetchList: async (overrides = {}) => {
    set({ loading: true, error: null })
    try {
      const params = { ...get().filters, ...overrides }
      const { data } = await api.getProducts(params)
      set({
        list:    extractRows(data),
        total:   data?.data?.total ?? data?.total ?? 0,
        loading: false,
      })
    } catch (e) {
      set({ error: e.response?.data?.error ?? e.response?.data?.message ?? 'Error al cargar productos', loading: false })
    }
  },

  fetchOne: async (id) => {
    set({ loading: true, error: null, detail: null })
    try {
      const { data } = await api.getProduct(id)
      const item = extractOne(data)
      set({ detail: item, loading: false })
      return item
    } catch (e) {
      set({ error: e.response?.data?.error ?? 'Producto no encontrado', loading: false })
      return null
    }
  },

  create: async (body) => {
    set({ loading: true, error: null })
    try {
      const { data } = await api.createProduct(body)
      const item = extractOne(data)
      set((s) => ({ list: [item, ...s.list], loading: false }))
      return { ok: true, data: item }
    } catch (e) {
      const message = e.response?.data?.error ?? e.response?.data?.message ?? 'Error al crear producto'
      set({ error: message, loading: false })
      return { ok: false, message }
    }
  },

  update: async (id, body) => {
    set({ loading: true, error: null })
    try {
      const { data } = await api.updateProduct(id, body)
      const item = extractOne(data)
      set((s) => ({
        list:    s.list.map((p) => p.id === id ? item : p),
        detail:  item,
        loading: false,
      }))
      return { ok: true, data: item }
    } catch (e) {
      const message = e.response?.data?.error ?? e.response?.data?.message ?? 'Error al actualizar producto'
      set({ error: message, loading: false })
      return { ok: false, message }
    }
  },

  toggle: async (id) => {
    try {
      await api.toggleProduct(id)
      set((s) => ({ list: s.list.map((p) => p.id === id ? { ...p, active: !p.active } : p) }))
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e.response?.data?.error ?? 'Error' }
    }
  },
}))
