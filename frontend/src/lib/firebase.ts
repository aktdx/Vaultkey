/**
 * Firebase Web SDK — initialization and Google provider.
 *
 * Initialized once (guarded by getApps()). Configuration comes entirely from
 * VITE_FIREBASE_* environment variables — no hardcoded values.
 *
 * Exports:
 *   auth           — FirebaseAuth instance
 *   googleProvider — GoogleAuthProvider instance (Google sign-in)
 */
import { initializeApp, getApps } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const requiredVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

for (const key of requiredVars) {
  if (!import.meta.env[key]) {
    throw new Error(
      `Firebase configuration error: ${key} is not set. ` +
      'Copy frontend/.env.example to frontend/.env and fill in your Firebase project values.'
    )
  }
}

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID as string,
}

// Guard against double-init in hot-reload / test environments
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]

export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
