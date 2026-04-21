import { create } from 'zustand'
import { createDispatch, listDispatches } from '../api/dispatch.api'

export const useDispatchStore = create((set) => ({
  list: [],
  loading: false,
  loadingList: false,
  error: null,
  lastDispatch: null,

  fetchList: async (params = {}) => {
    set({ loadingList: true, error: null })
    try {
      const data = await listDispatches(params)
      set({
        list: data.rows || data.data || data || [],
        loadingList: false,
      })
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al cargar histórico de despachos'
      set({ error: msg, loadingList: false })
    }
  },

  submit: async (body) => {
    set({ loading: true, error: null })
    try {
      const data = await createDispatch(body)
      set({ lastDispatch: data, loading: false })
      return { ok: true, data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al registrar despacho'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  clearError: () => set({ error: null }),
}))
