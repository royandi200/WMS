import { create } from 'zustand'
import { getWebhookLogs, getWebhookLogDetail } from '../api/webhook.api'

export const useWebhookStore = create((set) => ({
  logs:    [],
  detail:  null,
  meta:    { page: 1, total: 0 },
  filters: { from_phone: '', action: '', status: '' },
  loading: false,
  error:   null,

  fetchLogs: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      const data = await getWebhookLogs(params)
      set({
        logs:    data.rows  || data,
        meta:    { page: params.page || 1, total: data.total || 0 },
        loading: false,
      })
    } catch (e) {
      set({ error: e.response?.data?.message || 'Error al cargar logs', loading: false })
    }
  },

  fetchDetail: async (id) => {
    set({ loading: true, error: null })
    try {
      const data = await getWebhookLogDetail(id)
      set({ detail: data, loading: false })
      return data
    } catch (e) {
      set({ error: e.response?.data?.message || 'Log no encontrado', loading: false })
      return null
    }
  },

  setFilters: (filters) => set({ filters }),
  clearDetail: () => set({ detail: null }),
  clearError:  () => set({ error: null }),
}))
