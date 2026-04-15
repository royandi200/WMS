import { create } from 'zustand'

// localStorage persiste entre pestañas y F5 en Vercel (dominio propio).
// sessionStorage solo se usa en iframes sandboxed (ej: embeds de terceros).
const LS_KEY = 'wms-auth'

const load = () => {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

const save = (token, user) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ token, user })) } catch {}
}

const clear = () => {
  try { localStorage.removeItem(LS_KEY) } catch {}
}

const persisted = load()

export const useAuthStore = create((set) => ({
  token:           persisted.token   ?? null,
  user:            persisted.user    ?? null,
  isAuthenticated: !!persisted.token,

  setAuth: (token, user) => {
    save(token, user)
    set({ token, user, isAuthenticated: true })
  },

  logout: () => {
    clear()
    set({ token: null, user: null, isAuthenticated: false })
  },
}))
