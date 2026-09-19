import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Shield, Menu, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'

export const LandingNav: React.FC = () => {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  // Close mobile nav on route change
  useEffect(() => setOpen(false), [location])

  const navLinks = [
    { label: 'Security', href: '/security' },
    { label: 'How it works', href: '/#how-it-works' },
    { label: 'Pricing', href: '/#pricing' },
  ]

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-40 transition-all duration-500',
        scrolled
          ? 'bg-[rgba(0,0,0,0.85)] backdrop-blur-md border-b border-[rgba(209,208,208,0.06)]'
          : 'bg-transparent'
      )}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 group" aria-label="VaultKey home">
          <div className="relative w-7 h-7 flex items-center justify-center">
            <Shield size={20} className="text-[#D1D0D0] transition-transform duration-300 group-hover:scale-110" />
          </div>
          <span className="text-sm font-semibold tracking-[0.12em] uppercase text-[#D1D0D0]">
            VaultKey
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8" aria-label="Main navigation">
          {navLinks.map(link => (
            <a
              key={link.href}
              href={link.href}
              className="text-xs tracking-wide text-[rgba(209,208,208,0.55)] hover:text-[#D1D0D0] transition-colors duration-200 uppercase"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <Link to="/auth/login">
            <Button variant="ghost" size="sm">Log in</Button>
          </Link>
          <Link to="/auth/signup">
            <Button variant="primary" size="sm">Get started</Button>
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2 text-[rgba(209,208,208,0.6)] hover:text-[#D1D0D0]"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-[#090909] border-b border-[rgba(209,208,208,0.08)] px-6 pb-6">
          <nav className="flex flex-col gap-4 pt-4">
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-[rgba(209,208,208,0.7)] hover:text-[#D1D0D0] transition-colors"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <div className="pt-2 flex flex-col gap-2">
              <Link to="/auth/login">
                <Button variant="secondary" size="md" className="w-full">Log in</Button>
              </Link>
              <Link to="/auth/signup">
                <Button variant="primary" size="md" className="w-full">Get started</Button>
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
