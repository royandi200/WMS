import { create } from 'zustand'

// sessionStorage funciona en Vercel; localStorage falla en iframes sandboxed
const SS_KEY = 'wms-auth'

const load = () => {
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

const save = (token, user) => {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify({ token, user })) } catch {}
}

const clear = () => {
  try { sessionStorage.removeItem(SS_KEY) } catch {}
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
