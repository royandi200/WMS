import { create } from 'zustand'
import { createDispatch, listDispatches } from '../api/dispatch.api'

export const useDispatchStore = create((set) => ({
  loading: false,
  error:   null,
  lastDispatch: null,
  list: [],

  fetchList: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      const res = await listDispatches(params)
      const payload = res?.data?.data ?? res?.data ?? res
      const rows = Array.isArray(payload?.rows) ? payload.rows : []
      set({ list: rows, loading: false })
      return { ok: true, data: rows }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al cargar despachos'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
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
