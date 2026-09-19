import React, { createContext, useContext, useEffect, useState } from 'react'
import {
  apiLogin,
  apiRegister,
  apiGetMe,
  setToken,
  clearToken,
  getToken,
  type ApiUser,
} from '../lib/api'

interface AuthContextType {
  user: ApiUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => void
  signInWithGoogle: () => Promise<{ error: string | null }>
  resetPassword: (email: string) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextType | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<ApiUser | null>(null)
  const [loading, setLoading] = useState(true)

  // On mount: if a JWT exists, verify it by fetching /api/auth/me
  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }

    apiGetMe()
      .then(u => setUser(u))
      .catch(() => clearToken())
      .finally(() => setLoading(false))
  }, [])

  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    try {
      const res = await apiLogin(email, password)
      setToken(res.access_token)
      setUser(res.user)
      return { error: null }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Login failed' }
    }
  }

  const signUp = async (email: string, password: string): Promise<{ error: string | null }> => {
    try {
      const res = await apiRegister(email, password)
      setToken(res.access_token)
      setUser(res.user)
      return { error: null }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Registration failed' }
    }
  }

  const signOut = () => {
    clearToken()
    setUser(null)
  }

  // Google OAuth is not implemented in the FastAPI backend — show a notice
  const signInWithGoogle = async (): Promise<{ error: string | null }> => {
    return { error: 'Google sign-in is not available with the FastAPI backend. Use email/password.' }
  }

  const resetPassword = async (_email: string): Promise<{ error: string | null }> => {
    return { error: 'Password reset must be handled by your backend. Contact the administrator.' }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, signInWithGoogle, resetPassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
