import { create } from 'zustand'
import { getWebhookLogs, getWebhookLogDetail } from '../api/webhook.api'

const extractRows = (res) => {
  if (Array.isArray(res))             return { rows: res,           total: res.length }
  if (Array.isArray(res?.rows))       return { rows: res.rows,      total: res.total ?? res.rows.length }
  if (Array.isArray(res?.data?.rows)) return { rows: res.data.rows, total: res.data.total ?? res.data.rows.length }
  if (Array.isArray(res?.data))       return { rows: res.data,      total: res.data.length }
  return { rows: [], total: 0 }
}

export const useWebhookStore = create((set, get) => ({
  logs:    [],
  detail:  null,
  meta:    { page: 1, total: 0 },
  filters: { from_phone: '', action: '', status: '' },
  loading: false,
  error:   null,

  fetchLogs: async (params = {}) => {
    set({ loading: true, error: null })
    const merged = { ...get().filters, ...params }
    try {
      const res = await getWebhookLogs(merged)
      const { rows, total } = extractRows(res)
      set({
        logs:    rows,
        meta:    { page: merged.page || 1, total },
        loading: false,
      })
    } catch (e) {
      set({ error: e.response?.data?.error || e.response?.data?.message || 'Error al cargar logs', loading: false })
    }
  },

  fetchDetail: async (id) => {
    set({ loading: true, error: null })
    try {
      const res = await getWebhookLogDetail(id)
      const data = res?.data ?? res
      set({ detail: data, loading: false })
      return data
    } catch (e) {
      set({ error: e.response?.data?.error || 'Log no encontrado', loading: false })
      return null
    }
  },

  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  clearDetail: () => set({ detail: null }),
  clearError:  () => set({ error: null }),
}))
