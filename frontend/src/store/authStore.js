import { create } from 'zustand'

const STORAGE_KEY = 'wms_auth'

const safeReadAuth = () => {
  if (typeof window === 'undefined') {
    return { token: null, user: null, isAuthenticated: false }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { token: null, user: null, isAuthenticated: false }

    const parsed = JSON.parse(raw)
    const token = parsed?.token || null
    const user = parsed?.user || null

    return {
      token,
      user,
      isAuthenticated: Boolean(token),
    }
  } catch {
    return { token: null, user: null, isAuthenticated: false }
  }
}

const persistAuth = (token, user) => {
  if (typeof window === 'undefined') return
  try {
    if (!token) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }))
  } catch {}
}

const initial = safeReadAuth()

export const useAuthStore = create((set) => ({
  token: initial.token,
  user: initial.user,
  isAuthenticated: initial.isAuthenticated,

  setAuth: (token, user) => {
    persistAuth(token, user)
    set({ token, user, isAuthenticated: Boolean(token) })
  },

  logout: () => {
    persistAuth(null, null)
    set({ token: null, user: null, isAuthenticated: false })
  },
}))
