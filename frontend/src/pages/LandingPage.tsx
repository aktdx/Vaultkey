import React, { useEffect, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Upload, Lock, Share2, Eye, ShieldOff, Shield, Check, ChevronDown } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { LandingNav } from '../components/layout/LandingNav'
import { cn } from '../lib/utils'

const HeroScene = lazy(() => import('../components/three/HeroScene'))

// ── Section reveal hook ─────────────────────────────────────────────────────
function useReveal(selector = '.reveal') {
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const els = document.querySelectorAll<HTMLElement>(selector)

    if (prefersReduced) {
      els.forEach(el => el.classList.add('visible'))
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible')
          }
        })
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    )
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])
}

// ── Security step component ──────────────────────────────────────────────────
interface StepProps {
  number: string
  label: string
  title: string
  description: string
  icon: React.ReactNode
  delay?: number
}

const Step: React.FC<StepProps> = ({ number, label, title, description, icon, delay = 0 }) => (
  <div
    className={cn('reveal', delay > 0 && `reveal-delay-${delay}`)}
    style={{ '--delay': `${delay * 0.12}s` } as React.CSSProperties}
  >
    <div className="flex items-start gap-6 group">
      <div className="shrink-0 flex flex-col items-center">
        <div className="w-10 h-10 rounded border border-[rgba(209,208,208,0.1)] bg-[#0e0e0e] flex items-center justify-center text-[rgba(209,208,208,0.5)] transition-colors duration-300 group-hover:border-[rgba(209,208,208,0.25)] group-hover:text-[#D1D0D0]">
          {icon}
        </div>
        <div className="w-px flex-1 mt-4 bg-gradient-to-b from-[rgba(209,208,208,0.08)] to-transparent min-h-[40px]" />
      </div>
      <div className="flex-1 pb-10">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[10px] font-mono text-[rgba(209,208,208,0.3)] tracking-wider">{number}</span>
          <span className="text-[10px] font-medium tracking-[0.1em] uppercase text-[rgba(209,208,208,0.4)]">{label}</span>
        </div>
        <h3 className="text-lg font-medium text-[#D1D0D0] mb-2 tracking-tight">{title}</h3>
        <p className="text-sm text-[rgba(209,208,208,0.5)] leading-relaxed max-w-md">{description}</p>
      </div>
    </div>
  </div>
)

// ── Main Landing Page ────────────────────────────────────────────────────────
const LandingPage: React.FC = () => {
  useReveal()

  return (
    <div className="min-h-screen bg-black text-[#D1D0D0] overflow-x-hidden">
      <LandingNav />

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden" aria-label="Hero">
        {/* Three.js background */}
        <div className="absolute inset-0" aria-hidden="true">
          <Suspense fallback={null}>
            <HeroScene />
          </Suspense>
        </div>

        {/* Radial vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 80% 70% at 50% 50%, transparent 30%, rgba(0,0,0,0.7) 80%, rgba(0,0,0,0.95) 100%)' }}
          aria-hidden="true"
        />

        {/* Content */}
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          <div className="mb-8 inline-flex items-center gap-2.5 px-4 py-2 border border-[rgba(209,208,208,0.1)] rounded-sm bg-[rgba(0,0,0,0.4)] backdrop-blur-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-[#6dbf8c] animate-pulse" />
            <span className="text-[10px] tracking-[0.14em] uppercase text-[rgba(209,208,208,0.6)] font-medium">
              AES-256-GCM · Browser-side encryption · Zero-knowledge
            </span>
          </div>

          <h1
            className="font-semibold text-[#D1D0D0] mb-6"
            style={{ fontSize: 'clamp(2.8rem, 7vw, 6.5rem)', lineHeight: '0.95', letterSpacing: '-0.04em' }}
          >
            Share securely.<br />
            <span className="text-[rgba(209,208,208,0.4)]">Stay in control.</span>
          </h1>

          <p className="text-base md:text-lg text-[rgba(209,208,208,0.5)] max-w-xl mx-auto mb-10 leading-relaxed font-light">
            End-to-end encrypted file sharing with expiring links, download limits, password protection, and instant revocation.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/auth/signup">
              <Button
                variant="primary"
                size="lg"
                rightIcon={<ArrowRight size={15} />}
                className="shadow-[0_0_24px_rgba(209,208,208,0.1)]"
              >
                Secure your first file
              </Button>
            </Link>
            <a href="#how-it-works">
              <Button variant="ghost" size="lg" rightIcon={<ChevronDown size={15} />}>
                See how it works
              </Button>
            </a>
          </div>

          {/* Trust indicators */}
          <div className="mt-16 flex flex-wrap justify-center gap-6">
            {['AES-256-GCM Encrypted', 'Zero-knowledge delivery', 'Instant revocation', 'No tracking'].map(item => (
              <div key={item} className="flex items-center gap-2">
                <Check size={12} className="text-[rgba(209,208,208,0.4)]" />
                <span className="text-xs text-[rgba(209,208,208,0.4)]">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce" aria-hidden="true">
          <div className="w-px h-12 bg-gradient-to-b from-transparent to-[rgba(209,208,208,0.2)]" />
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────────────────── */}
      <section id="how-it-works" className="relative py-32 px-6" aria-label="How VaultKey works">
        {/* Grid background */}
        <div className="absolute inset-0 vault-grid-bg pointer-events-none opacity-50" aria-hidden="true" />

        <div className="max-w-4xl mx-auto">
          <div className="reveal mb-20">
            <span className="text-[10px] tracking-[0.16em] uppercase text-[rgba(209,208,208,0.35)] font-medium mb-4 block">
              The VaultKey workflow
            </span>
            <h2
              className="font-semibold text-[#D1D0D0]"
              style={{ fontSize: 'clamp(1.8rem, 4vw, 3.2rem)', lineHeight: '1.05', letterSpacing: '-0.03em' }}
            >
              From upload to access,<br />every step is secured.
            </h2>
          </div>

          <div className="relative">
            <Step
              number="01"
              label="Upload"
              title="Select your file"
              description="Drag and drop or select any file. VaultKey begins the security process immediately in your browser."
              icon={<Upload size={16} />}
              delay={0}
            />
            <Step
              number="02"
              label="Encrypt"
              title="Browser-side AES-256-GCM encryption"
              description="Your file is encrypted locally using the Web Crypto API before it leaves your device. The encryption key never touches our servers."
              icon={<Lock size={16} />}
              delay={1}
            />
            <Step
              number="03"
              label="Protect"
              title="Configure your access controls"
              description="Set an expiration date, download limit, and optional password. You decide who can access your file and for how long."
              icon={<Shield size={16} />}
              delay={2}
            />
            <Step
              number="04"
              label="Share"
              title="Receive a secure sharing link"
              description="A unique token is generated. The decryption key is embedded in the URL fragment — it's never transmitted to our servers."
              icon={<Share2 size={16} />}
              delay={3}
            />
            <Step
              number="05"
              label="Monitor"
              title="Track every access event"
              description="See who accessed your file, when, and from where. Every download attempt is logged in real time."
              icon={<Eye size={16} />}
              delay={4}
            />
            <Step
              number="06"
              label="Revoke"
              title="Instant revocation"
              description="Changed your mind? Revoke access instantly. The secure link becomes permanently invalid — no questions asked."
              icon={<ShieldOff size={16} />}
              delay={5}
            />
          </div>
        </div>
      </section>

      {/* ── SECURITY ARCHITECTURE ─────────────────────────────────────── */}
      <section className="relative py-32 px-6 bg-[#060606]" aria-label="Security architecture">
        <div className="max-w-5xl mx-auto">
          <div className="reveal text-center mb-20">
            <span className="text-[10px] tracking-[0.16em] uppercase text-[rgba(209,208,208,0.35)] font-medium mb-4 block">
              Architecture
            </span>
            <h2
              className="font-semibold text-[#D1D0D0]"
              style={{ fontSize: 'clamp(1.8rem, 4vw, 3.2rem)', lineHeight: '1.05', letterSpacing: '-0.03em' }}
            >
              Built on real security,<br />not security theater.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-px bg-[rgba(209,208,208,0.06)] rounded-lg overflow-hidden">
            {[
              {
                icon: <Lock size={18} />,
                title: 'AES-256-GCM',
                desc: 'Industry-standard authenticated encryption. Files are encrypted before upload using the Web Crypto API.',
                tag: 'IMPLEMENTED',
              },
              {
                icon: <Shield size={18} />,
                title: 'Zero-knowledge delivery',
                desc: 'Decryption keys travel in URL fragments (#key=...) — never transmitted to or stored by VaultKey servers.',
                tag: 'IMPLEMENTED',
              },
              {
                icon: <Eye size={18} />,
                title: 'Atomic download limits',
                desc: 'Download counters are incremented atomically at the database layer, preventing race-condition bypasses.',
                tag: 'IMPLEMENTED',
              },
            ].map((feature, i) => (
              <div
                key={i}
                className={cn('reveal bg-[#080808] p-8', i > 0 && 'reveal-delay-' + i)}
              >
                <div className="text-[rgba(209,208,208,0.5)] mb-5">{feature.icon}</div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="text-sm font-medium text-[#D1D0D0]">{feature.title}</h3>
                  <span className="text-[9px] tracking-wider text-[rgba(109,191,140,0.7)] bg-[rgba(109,191,140,0.08)] border border-[rgba(109,191,140,0.15)] px-1.5 py-0.5 rounded-sm font-medium shrink-0">
                    {feature.tag}
                  </span>
                </div>
                <p className="text-xs text-[rgba(209,208,208,0.45)] leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ───────────────────────────────────────────────────── */}
      <section id="pricing" className="relative py-32 px-6" aria-label="Pricing">
        <div className="max-w-4xl mx-auto">
          <div className="reveal text-center mb-20">
            <span className="text-[10px] tracking-[0.16em] uppercase text-[rgba(209,208,208,0.35)] font-medium mb-4 block">
              Pricing
            </span>
            <h2
              className="font-semibold text-[#D1D0D0]"
              style={{ fontSize: 'clamp(1.8rem, 4vw, 3.2rem)', lineHeight: '1.05', letterSpacing: '-0.03em' }}
            >
              Simple, transparent pricing.
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Free */}
            <div className="reveal border border-[rgba(209,208,208,0.08)] rounded-lg p-8 bg-[#090909]">
              <div className="mb-6">
                <span className="text-[10px] tracking-[0.12em] uppercase text-[rgba(209,208,208,0.4)]">Free</span>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-4xl font-semibold text-[#D1D0D0] tracking-tight">$0</span>
                  <span className="text-sm text-[rgba(209,208,208,0.4)] mb-1">/month</span>
                </div>
              </div>
              <ul className="space-y-3 mb-8">
                {['5 files / month', 'Up to 25 MB per file', 'Links expire after 7 days', 'Download limit controls', 'Activity log (7 days)'].map(f => (
                  <li key={f} className="flex items-center gap-3 text-sm text-[rgba(209,208,208,0.6)]">
                    <Check size={13} className="text-[rgba(209,208,208,0.4)] shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link to="/auth/signup">
                <Button variant="secondary" size="md" className="w-full">Get started free</Button>
              </Link>
            </div>

            {/* Pro */}
            <div className="reveal reveal-delay-1 border border-[rgba(209,208,208,0.2)] rounded-lg p-8 bg-[#0c0c0c] relative overflow-hidden">
              <div className="absolute top-0 right-0 px-3 py-1 bg-[rgba(209,208,208,0.08)] border-l border-b border-[rgba(209,208,208,0.1)] text-[9px] tracking-[0.12em] uppercase text-[rgba(209,208,208,0.6)] rounded-bl-sm">
                Popular
              </div>
              <div className="mb-6">
                <span className="text-[10px] tracking-[0.12em] uppercase text-[rgba(209,208,208,0.4)]">Pro</span>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-4xl font-semibold text-[#D1D0D0] tracking-tight">$12</span>
                  <span className="text-sm text-[rgba(209,208,208,0.4)] mb-1">/month</span>
                </div>
              </div>
              <ul className="space-y-3 mb-8">
                {['Unlimited files', 'Up to 5 GB per file', 'Custom expiration dates', 'Password protection', 'Full activity history', 'Priority support'].map(f => (
                  <li key={f} className="flex items-center gap-3 text-sm text-[rgba(209,208,208,0.6)]">
                    <Check size={13} className="text-[#6dbf8c] shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link to="/auth/signup">
                <Button variant="primary" size="md" className="w-full">Start free trial</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────────────────── */}
      <section className="relative py-40 px-6 overflow-hidden" aria-label="Call to action">
        <div className="absolute inset-0 vault-grid-bg opacity-30 pointer-events-none" aria-hidden="true" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(92,78,78,0.08) 0%, transparent 70%)' }}
          aria-hidden="true"
        />

        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <div className="reveal mb-3 inline-flex items-center gap-2">
            <Shield size={14} className="text-[rgba(209,208,208,0.4)]" />
            <span className="text-[10px] tracking-[0.16em] uppercase text-[rgba(209,208,208,0.35)]">VaultKey</span>
          </div>
          <h2
            className="reveal reveal-delay-1 font-semibold text-[#D1D0D0] mb-6"
            style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', lineHeight: '1.0', letterSpacing: '-0.035em' }}
          >
            Your files deserve<br />serious protection.
          </h2>
          <p className="reveal reveal-delay-2 text-base text-[rgba(209,208,208,0.45)] max-w-md mx-auto mb-10 leading-relaxed font-light">
            Start securing your files today. No credit card required.
          </p>
          <div className="reveal reveal-delay-3 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/auth/signup">
              <Button
                variant="primary"
                size="lg"
                rightIcon={<ArrowRight size={15} />}
                className="shadow-[0_0_32px_rgba(209,208,208,0.08)]"
              >
                Secure your first file
              </Button>
            </Link>
            <Link to="/security">
              <Button variant="ghost" size="lg">Read security docs</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────── */}
      <footer className="border-t border-[rgba(209,208,208,0.07)] py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <Shield size={14} className="text-[rgba(209,208,208,0.4)]" />
            <span className="text-xs font-semibold tracking-[0.12em] uppercase text-[rgba(209,208,208,0.4)]">VaultKey</span>
          </div>
          <p className="text-xs text-[rgba(209,208,208,0.25)]">
            © {new Date().getFullYear()} VaultKey. Privacy-first file sharing.
          </p>
          <div className="flex items-center gap-6">
            {['Privacy', 'Terms', 'Security'].map(link => (
              <a
                key={link}
                href="#"
                className="text-xs text-[rgba(209,208,208,0.3)] hover:text-[rgba(209,208,208,0.6)] transition-colors"
              >
                {link}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
