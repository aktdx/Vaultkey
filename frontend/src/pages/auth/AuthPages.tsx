import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Shield, Eye, EyeOff } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'

const AuthLayout: React.FC<{ children: React.ReactNode; title: string; subtitle?: string }> = ({ children, title, subtitle }) => (
  <div className="min-h-screen bg-black flex items-center justify-center px-4 py-16">
    {/* Subtle background */}
    <div className="fixed inset-0 vault-grid-bg opacity-30 pointer-events-none" aria-hidden="true" />
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ background: 'radial-gradient(ellipse 50% 60% at 50% 50%, rgba(92,78,78,0.05) 0%, transparent 70%)' }}
      aria-hidden="true"
    />

    <div className="relative z-10 w-full max-w-sm">
      {/* Logo */}
      <Link to="/" className="flex items-center justify-center gap-2 mb-10">
        <Shield size={18} className="text-[#D1D0D0]" />
        <span className="text-xs font-semibold tracking-[0.14em] uppercase text-[#D1D0D0]">VaultKey</span>
      </Link>

      {/* Card */}
      <div className="rounded-lg border border-[rgba(209,208,208,0.1)] bg-[#0a0a0a] p-8">
        <div className="mb-7">
          <h1 className="text-xl font-medium text-[#D1D0D0] tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-[rgba(209,208,208,0.45)]">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  </div>
)

// ── LOGIN PAGE ───────────────────────────────────────────────────────────────
export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const { signIn, signInWithGoogle } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      toast('error', 'Authentication failed', error)
    } else {
      navigate('/dashboard')
    }
  }

  const handleGoogle = async () => {
    const { error } = await signInWithGoogle()
    if (error) toast('error', 'Google sign-in failed', error)
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your secure workspace">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />
        <Input
          label="Password"
          type={showPwd ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          rightElement={
            <button type="button" onClick={() => setShowPwd(!showPwd)} aria-label={showPwd ? 'Hide password' : 'Show password'}>
              {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          }
        />

        <div className="flex justify-end">
          <Link to="/auth/forgot-password" className="text-xs text-[rgba(209,208,208,0.4)] hover:text-[rgba(209,208,208,0.7)] transition-colors">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" variant="primary" size="md" className="w-full mt-2" loading={loading}>
          Sign in
        </Button>

        <div className="relative flex items-center gap-3 py-1">
          <div className="flex-1 h-px bg-[rgba(209,208,208,0.08)]" />
          <span className="text-[10px] text-[rgba(209,208,208,0.3)] tracking-wide">OR</span>
          <div className="flex-1 h-px bg-[rgba(209,208,208,0.08)]" />
        </div>

        <Button type="button" variant="secondary" size="md" className="w-full" onClick={handleGoogle}>
          <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18L12.048 13.56c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
          </svg>
          Continue with Google
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-[rgba(209,208,208,0.35)]">
        Don't have an account?{' '}
        <Link to="/auth/signup" className="text-[rgba(209,208,208,0.7)] hover:text-[#D1D0D0] transition-colors">
          Sign up
        </Link>
      </p>
    </AuthLayout>
  )
}

// ── SIGNUP PAGE ──────────────────────────────────────────────────────────────
export const SignupPage: React.FC = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const { signUp, signInWithGoogle } = useAuth()
  const toast = useToast()

  const strength = (() => {
    let s = 0
    if (password.length >= 8) s++
    if (/[A-Z]/.test(password)) s++
    if (/[0-9]/.test(password)) s++
    if (/[^A-Za-z0-9]/.test(password)) s++
    return s
  })()

  const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong']
  const strengthColors = ['', 'bg-[#e87b7b]', 'bg-[#e8c07b]', 'bg-[#D1D0D0]', 'bg-[#6dbf8c]']

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      toast('warning', 'Password too short', 'Use at least 8 characters.')
      return
    }
    setLoading(true)
    const { error } = await signUp(email, password)
    setLoading(false)
    if (error) {
      toast('error', 'Signup failed', error)
    } else {
      setDone(true)
    }
  }

  if (done) {
    return (
      <AuthLayout title="Check your email" subtitle="We sent a verification link to your inbox.">
        <div className="text-center py-4">
          <div className="w-12 h-12 rounded-full border border-[rgba(109,191,140,0.3)] bg-[rgba(109,191,140,0.08)] flex items-center justify-center mx-auto mb-4">
            <Shield size={20} className="text-[#6dbf8c]" />
          </div>
          <p className="text-sm text-[rgba(209,208,208,0.5)] leading-relaxed">
            Click the link in your email to activate your VaultKey account.
          </p>
          <Link to="/auth/login" className="mt-6 block">
            <Button variant="secondary" size="md" className="w-full">Back to login</Button>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Create your account" subtitle="Secure file sharing starts here">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />
        <div>
          <Input
            label="Password"
            type={showPwd ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Choose a strong password"
            required
            rightElement={
              <button type="button" onClick={() => setShowPwd(!showPwd)} aria-label={showPwd ? 'Hide password' : 'Show password'}>
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            }
          />
          {password && (
            <div className="mt-2">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map(i => (
                  <div
                    key={i}
                    className={`h-0.5 flex-1 rounded-full transition-all duration-300 ${i <= strength ? strengthColors[strength] : 'bg-[rgba(209,208,208,0.1)]'}`}
                  />
                ))}
              </div>
              <p className={`mt-1 text-[10px] ${strength === 4 ? 'text-[#6dbf8c]' : strength >= 2 ? 'text-[rgba(209,208,208,0.5)]' : 'text-[#e8c07b]'}`}>
                {strengthLabels[strength]}
              </p>
            </div>
          )}
        </div>

        <Button type="submit" variant="primary" size="md" className="w-full mt-2" loading={loading}>
          Create secure account
        </Button>

        <div className="relative flex items-center gap-3 py-1">
          <div className="flex-1 h-px bg-[rgba(209,208,208,0.08)]" />
          <span className="text-[10px] text-[rgba(209,208,208,0.3)] tracking-wide">OR</span>
          <div className="flex-1 h-px bg-[rgba(209,208,208,0.08)]" />
        </div>

        <Button type="button" variant="secondary" size="md" className="w-full" onClick={() => signInWithGoogle()}>
          <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18L12.048 13.56c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
          </svg>
          Continue with Google
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-[rgba(209,208,208,0.35)]">
        Already have an account?{' '}
        <Link to="/auth/login" className="text-[rgba(209,208,208,0.7)] hover:text-[#D1D0D0] transition-colors">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}

// ── FORGOT PASSWORD PAGE ─────────────────────────────────────────────────────
export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const { resetPassword } = useAuth()
  const toast = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await resetPassword(email)
    setLoading(false)
    if (error) {
      toast('error', 'Reset failed', error)
    } else {
      setSent(true)
    }
  }

  return (
    <AuthLayout title="Reset password" subtitle="Enter your email to receive a reset link">
      {sent ? (
        <div className="text-center py-2">
          <p className="text-sm text-[rgba(209,208,208,0.5)]">
            Check your inbox. If that email is registered, you'll receive a reset link shortly.
          </p>
          <Link to="/auth/login" className="mt-6 block">
            <Button variant="secondary" size="md" className="w-full">Back to login</Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
          <Button type="submit" variant="primary" size="md" className="w-full" loading={loading}>
            Send reset link
          </Button>
          <Link to="/auth/login" className="block">
            <Button variant="ghost" size="md" className="w-full">Back to login</Button>
          </Link>
        </form>
      )}
    </AuthLayout>
  )
}
