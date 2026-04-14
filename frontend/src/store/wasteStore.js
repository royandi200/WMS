import { create } from 'zustand'
import { reportWaste, listWaste } from '../api/waste.api'

export const useWasteStore = create((set) => ({
  list:    [],
  loading: false,
  error:   null,

  fetchList: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      const data = await listWaste(params)
      set({ list: data.rows || data, loading: false })
    } catch (e) {
      set({ error: e.response?.data?.message || 'Error al cargar mermas', loading: false })
    }
  },

  submit: async (body) => {
    set({ loading: true, error: null })
    try {
      const data = await reportWaste(body)
      set({ loading: false })
      return { ok: true, data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al reportar merma'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  clearError: () => set({ error: null }),
}))
