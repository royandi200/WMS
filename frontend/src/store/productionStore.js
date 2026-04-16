import { create } from 'zustand'
import {
  startProduction,
  confirmMaterials,
  advancePhase,
  closeProduction,
  listProductions,
  getProduction,
} from '../api/production.api'

// client.js devuelve el objeto Axios completo; production.api.js extrae .data manualmente.
// El backend Express devuelve { ok: true, data: { count, rows } } (Sequelize findAndCountAll)
// => listProductions() resuelve en { ok, data: { count, rows } }
// => hay que leer payload.data.rows
// Rows de Sequelize tienen el producto anidado: r.producto.{ siigo_code, nombre }

const normalizeOrden = (r) => ({
  ...r,
  id:            r.id,
  codigo_orden:  r.codigo_orden,
  product_id:    r.producto_id           ?? r.product_id,
  product_name:  r.producto?.nombre      ?? r.product_name ?? r.nombre,
  sku:           r.producto?.siigo_code  ?? r.sku          ?? r.siigo_code,
  qty_planned:   r.cantidad_planeada     ?? r.qty_planned,
  qty_real:      r.cantidad_real         ?? r.qty_real,
  current_phase: r.fase                  ?? r.current_phase,
  status:        r.estado                ?? r.status,
  created_at:    r.creado_en             ?? r.created_at,
})

export const useProductionStore = create((set) => ({
  list:    [],
  current: null,
  loading: false,
  error:   null,

  fetchList: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      // payload = { ok: true, data: { count, rows: [...] } }
      const payload = await listProductions(params)
      const rows    = payload?.data?.rows ?? payload?.rows ?? (Array.isArray(payload) ? payload : [])
      set({ list: rows.map(normalizeOrden), loading: false })
    } catch (e) {
      set({
        error: e.response?.data?.error || e.response?.data?.message || 'Error al cargar producciones',
        loading: false,
      })
    }
  },

  fetchOne: async (id) => {
    set({ loading: true, error: null })
    try {
      const payload = await getProduction(id)
      const orden   = payload?.data ?? payload
      const normalized = normalizeOrden(orden)
      set({ current: normalized, loading: false })
      return normalized
    } catch (e) {
      set({
        error: e.response?.data?.error || e.response?.data?.message || 'Orden no encontrada',
        loading: false,
      })
      return null
    }
  },

  start: async (body) => {
    set({ loading: true, error: null })
    try {
      const payload = await startProduction(body)
      set({ loading: false })
      return { ok: true, data: payload?.data ?? payload }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al iniciar producción'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  confirm: async (body) => {
    set({ loading: true, error: null })
    try {
      const payload = await confirmMaterials(body)
      set({ loading: false })
      return { ok: true, data: payload?.data ?? payload }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al confirmar materiales'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  advance: async (body) => {
    set({ loading: true, error: null })
    try {
      const payload = await advancePhase(body)
      // payload = { ok, data: { order_code, phase } }
      const { order_code, phase } = payload?.data ?? payload ?? {}
      if (phase) {
        set((state) => ({
          list: state.list.map((o) =>
            o.codigo_orden === order_code || String(o.id) === String(body.order_id)
              ? { ...o, current_phase: phase, fase: phase }
              : o
          ),
        }))
      }
      set({ loading: false })
      return { ok: true, data: payload?.data ?? payload }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al avanzar fase'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  close: async (body) => {
    set({ loading: true, error: null })
    try {
      const payload = await closeProduction(body)
      set({ loading: false })
      return { ok: true, data: payload?.data ?? payload }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al cerrar producción'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  clearError: () => set({ error: null }),
}))
