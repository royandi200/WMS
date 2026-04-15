import { create } from 'zustand'
import * as api from '../api/products.api'

// El interceptor de client.js ya extrae response.data.data
// asi que api.getProducts() devuelve el array directamente
const toArray = (res) => {
  if (Array.isArray(res))        return res
  if (Array.isArray(res?.rows))  return res.rows
  if (Array.isArray(res?.data))  return res.data
  return []
}

export const useProductsStore = create((set, get) => ({
  list:    [],
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
      const res = await api.getProducts(params)          // ya es el payload limpio
      set({ list: toArray(res), loading: false })
    } catch (e) {
      set({ list: [], error: e.response?.data?.message ?? 'Error al cargar productos', loading: false })
    }
  },

  fetchOne: async (id) => {
    set({ loading: true, error: null, detail: null })
    try {
      const res = await api.getProduct(id)
      const detail = res?.data ?? res
      set({ detail, loading: false })
      return detail
    } catch (e) {
      set({ error: e.response?.data?.message ?? 'Producto no encontrado', loading: false })
      return null
    }
  },

  create: async (body) => {
    set({ loading: true, error: null })
    try {
      const res = await api.createProduct(body)
      const product = res?.data ?? res
      set((s) => ({ list: [product, ...s.list], loading: false }))
      return { ok: true, data: product }
    } catch (e) {
      const message = e.response?.data?.error ?? e.response?.data?.message ?? 'Error al crear producto'
      set({ error: message, loading: false })
      return { ok: false, message }
    }
  },

  update: async (id, body) => {
    set({ loading: true, error: null })
    try {
      const res = await api.updateProduct(id, body)
      const product = res?.data ?? res
      set((s) => ({ list: s.list.map((p) => p.id === id ? product : p), detail: product, loading: false }))
      return { ok: true, data: product }
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
      return { ok: false, message: e.response?.data?.error ?? e.response?.data?.message ?? 'Error' }
    }
  },
}))
