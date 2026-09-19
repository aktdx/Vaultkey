import React, { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'

// Lazy-loaded pages
const LandingPage = lazy(() => import('./pages/LandingPage'))
const SecurityPage = lazy(() => import('./pages/SecurityPage'))
const SecureDownloadPage = lazy(() => import('./pages/SecureDownloadPage').then(m => ({ default: m.SecureDownloadPage })))
const LoginPage = lazy(() => import('./pages/auth/AuthPages').then(m => ({ default: m.LoginPage })))
const SignupPage = lazy(() => import('./pages/auth/AuthPages').then(m => ({ default: m.SignupPage })))
const ForgotPasswordPage = lazy(() => import('./pages/auth/AuthPages').then(m => ({ default: m.ForgotPasswordPage })))

import { DashboardPage } from './pages/dashboard/DashboardPage'
import { FilesPage } from './pages/dashboard/FilesPage'
import { SharesPage } from './pages/dashboard/SharesPage'
import { ActivityPage } from './pages/dashboard/ActivityPage'
import { SettingsPage } from './pages/dashboard/SettingsPage'

// Full-screen loading fallback
const PageLoader: React.FC = () => (
  <div className="min-h-screen bg-black flex items-center justify-center">
    <div className="w-8 h-8 border border-[rgba(209,208,208,0.15)] border-t-[rgba(209,208,208,0.5)] rounded-full animate-spin" />
  </div>
)

// Protected route wrapper
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/auth/login" state={{ from: location }} replace />
  return <>{children}</>
}

// Public route (redirect to dashboard if already authed)
const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (user) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public marketing */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/security" element={<SecurityPage />} />

        {/* Public secure download */}
        <Route path="/s/:token" element={<SecureDownloadPage />} />

        {/* Auth */}
        <Route path="/auth/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/auth/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />
        <Route path="/auth/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />

        {/* Dashboard (protected) */}
        <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/dashboard/files" element={<ProtectedRoute><FilesPage /></ProtectedRoute>} />
        <Route path="/dashboard/shares" element={<ProtectedRoute><SharesPage /></ProtectedRoute>} />
        <Route path="/dashboard/activity" element={<ProtectedRoute><ActivityPage /></ProtectedRoute>} />
        <Route path="/dashboard/security" element={<ProtectedRoute><SecurityPage /></ProtectedRoute>} />
        <Route path="/dashboard/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </AuthProvider>
  )
}

export default App
