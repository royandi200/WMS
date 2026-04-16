import { create } from 'zustand'
import {
  getProductions,
  getProduction,
  startOrder,
  confirmOrder,
  advanceOrder,
  closeOrder,
} from '../api/production.api'

// client.js intercepta { ok, data: <payload> } y devuelve <payload> directamente.
// El backend Express usa Sequelize findAndCountAll → { count, rows: [OrdenProduccion] }
// donde cada fila tiene el producto anidado en r.producto.{ siigo_code, nombre }

const normalizeOrden = (r) => ({
  ...r,
  // IDs y códigos
  id:            r.id,
  codigo_orden:  r.codigo_orden,
  // Producto — Sequelize anida el include como r.producto
  product_id:    r.producto_id          ?? r.product_id,
  product_name:  r.producto?.nombre     ?? r.product_name ?? r.nombre,
  sku:           r.producto?.siigo_code ?? r.sku          ?? r.siigo_code,
  // Cantidades
  qty_planned:   r.cantidad_planeada    ?? r.qty_planned,
  qty_real:      r.cantidad_real        ?? r.qty_real,
  // Estado y fase
  current_phase: r.fase                 ?? r.current_phase,
  status:        r.estado               ?? r.status,
  // Fechas
  created_at:    r.creado_en            ?? r.created_at,
})

export const useProductionStore = create((set) => ({
  list:    [],
  current: null,
  loading: false,
  error:   null,

  fetchList: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      // interceptor extrae .data → res = { count, rows } (Sequelize findAndCountAll)
      const res  = await getProductions(params)
      const rows = res?.rows ?? (Array.isArray(res) ? res : [])
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
      const res = await getProduction(id)
      const normalized = normalizeOrden(res)
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
      const res = await startOrder(body)
      set({ loading: false })
      return { ok: true, data: res }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al iniciar producción'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  confirm: async (body) => {
    set({ loading: true, error: null })
    try {
      const res = await confirmOrder(body)
      set({ loading: false })
      return { ok: true, data: res }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al confirmar materiales'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  advance: async (body) => {
    set({ loading: true, error: null })
    try {
      const res = await advanceOrder(body)
      // res = { order_code, phase }
      const { phase, order_code } = res ?? {}
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
      return { ok: true, data: res }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al avanzar fase'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  close: async (body) => {
    set({ loading: true, error: null })
    try {
      const res = await closeOrder(body)
      set({ loading: false })
      return { ok: true, data: res }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al cerrar producción'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  clearError: () => set({ error: null }),
}))
