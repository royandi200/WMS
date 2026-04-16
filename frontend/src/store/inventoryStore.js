import { create } from 'zustand'
import {
  getSummary,
  getProductStock,
  getLotDetail,
  getKardex,
  getLowStock,
} from '../api/inventory.api'

// api.js ya hace .then(r => r.data) → llega como { ok, data: <payload> }
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
  loadingSummary:  false,
  loadingKardex:   false,
  loadingLowStock: false,
  loading:         false,
  error:           null,

  fetchSummary: async () => {
    set({ loadingSummary: true, loading: true, error: null })
    try {
      const res  = await getSummary()
      const data = unwrap(res)
      console.group('[STORE] fetchSummary')
      console.log('raw res:',  res)
      console.log('unwrapped:', data)
      console.log('isArray:',  Array.isArray(data))
      if (Array.isArray(data) && data.length) {
        console.log('primer item keys:', Object.keys(data[0]))
        console.log('primer item.stock:', data[0].stock)
      }
      console.groupEnd()
      set({ summary: data, loadingSummary: false, loading: false })
    } catch (e) {
      console.error('[STORE] fetchSummary ERROR', e)
      set({ error: e.response?.data?.error || 'Error al cargar resumen', loadingSummary: false, loading: false })
    }
  },

  fetchLowStock: async () => {
    set({ loadingLowStock: true, error: null })
    try {
      const res  = await getLowStock()
      const data = unwrap(res)
      console.group('[STORE] fetchLowStock')
      console.log('raw res:',   res)
      console.log('unwrapped:', data)
      console.log('isArray:',   Array.isArray(data))
      if (Array.isArray(data) && data.length) {
        console.log('primer item:', data[0])
      }
      console.groupEnd()
      set({ lowStock: Array.isArray(data) ? data : (data?.rows ?? []), loadingLowStock: false })
    } catch (e) {
      console.error('[STORE] fetchLowStock ERROR', e)
      set({ error: e.response?.data?.error || 'Error al cargar stock bajo', loadingLowStock: false })
    }
  },

  fetchKardex: async (params = {}) => {
    set({ loadingKardex: true, error: null })
    try {
      const res           = await getKardex(params)
      const { rows, total } = unwrapRows(res)
      console.group('[STORE] fetchKardex')
      console.log('raw res:',    res)
      console.log('rows.length:', rows.length, '/ total:', total)
      if (rows.length) {
        console.log('primer row keys:', Object.keys(rows[0]))
        console.log('primer row:',      rows[0])
        console.log('tipos distintos:', [...new Set(rows.map(r => r.tipo))])
        console.log('sample creado_en:', rows[0].creado_en)
      }
      console.groupEnd()
      set({ kardex: rows, kardexMeta: { page: params.page || 1, total }, loadingKardex: false })
    } catch (e) {
      console.error('[STORE] fetchKardex ERROR', e)
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

  clearError: () => set({ error: null }),
}))
