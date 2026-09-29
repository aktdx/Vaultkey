import React, { createContext, useContext, useEffect, useState } from 'react'
import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth'
import { auth, googleProvider, isFirebaseConfigured } from '../lib/firebase'
import {
  apiLogin,
  apiRegister,
  apiGetMe,
  apiGoogleAuth,
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
  googleAuthEnabled: boolean
  resetPassword: (email: string) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextType | null>(null)

// Map Firebase auth error codes to user-friendly messages.
function googleErrorMessage(code: string): string {
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in cancelled.'
    case 'auth/popup-blocked':
      return 'Pop-up was blocked by your browser. Please allow pop-ups for this site and try again.'
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email. Please sign in with your original method.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.'
    default:
      return 'Google sign-in failed. Please try again.'
  }
}

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
    // Clear Firebase client session; failure is non-fatal for VaultKey logout
    if (auth) firebaseSignOut(auth).catch(() => {/* no-op */})
  }

  const signInWithGoogle = async (): Promise<{ error: string | null }> => {
    if (!auth || !googleProvider) {
      return { error: 'Google sign-in is not configured for this environment.' }
    }

    try {
      const result = await signInWithPopup(auth, googleProvider)
      const idToken = await result.user.getIdToken(/* forceRefresh */ true)
      const res = await apiGoogleAuth(idToken)
      setToken(res.access_token)
      setUser(res.user)
      return { error: null }
    } catch (e: unknown) {
      // Firebase errors carry a `code` property
      const code = (e as { code?: string }).code ?? ''
      if (code.startsWith('auth/')) {
        return { error: googleErrorMessage(code) }
      }
      // Backend error (apiGoogleAuth threw)
      return { error: e instanceof Error ? e.message : 'Google sign-in failed. Please try again.' }
    }
  }

  const resetPassword = async (_email: string): Promise<{ error: string | null }> => {
    return { error: 'Password reset must be handled by your backend. Contact the administrator.' }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, signInWithGoogle, googleAuthEnabled: isFirebaseConfigured, resetPassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
