import React from 'react'
import { Link } from 'react-router-dom'
import { Check, ArrowRight, Shield } from 'lucide-react'
import { LandingNav } from '../components/layout/LandingNav'
import { Button } from '../components/ui/Button'

const PricingPage: React.FC = () => (
  <div className="min-h-screen bg-black text-[#D1D0D0]">
    <LandingNav />

    <main className="pt-32 pb-32 px-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-20">
          <span className="text-[10px] tracking-[0.16em] uppercase text-[rgba(209,208,208,0.35)] mb-5 block">
            Pricing
          </span>
          <h1
            className="font-semibold text-[#D1D0D0] mb-6"
            style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: '1.05', letterSpacing: '-0.035em' }}
          >
            Simple, transparent pricing.
          </h1>
          <p className="text-base text-[rgba(209,208,208,0.5)] leading-[1.75] max-w-md mx-auto">
            Start free, upgrade when you need more. No hidden fees, no surprises.
          </p>
        </div>

        {/* Cards */}
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {/* Free */}
          <div className="border border-[rgba(209,208,208,0.08)] rounded-lg p-8 bg-[#090909]">
            <div className="mb-8">
              <span className="text-[10px] tracking-[0.12em] uppercase text-[rgba(209,208,208,0.4)]">Free</span>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-4xl font-semibold text-[#D1D0D0] tracking-tight">₹0</span>
                <span className="text-sm text-[rgba(209,208,208,0.4)] mb-1">/month</span>
              </div>
              <p className="mt-3 text-xs text-[rgba(209,208,208,0.4)]">Perfect for occasional secure sharing</p>
            </div>
            <ul className="space-y-3.5 mb-8">
              {['5 files / week', 'Up to 50 MB per file', 'Links expire after 7 days', 'Download limit controls', 'Activity log (7 days)'].map(f => (
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
          <div className="border border-[rgba(209,208,208,0.2)] rounded-lg p-8 bg-[#0c0c0c] relative overflow-hidden">
            <div className="absolute top-0 right-0 px-3 py-1 bg-[rgba(209,208,208,0.08)] border-l border-b border-[rgba(209,208,208,0.1)] text-[9px] tracking-[0.12em] uppercase text-[rgba(209,208,208,0.6)] rounded-bl-sm">
              Popular
            </div>
            <div className="mb-8">
              <span className="text-[10px] tracking-[0.12em] uppercase text-[rgba(209,208,208,0.4)]">Pro</span>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-4xl font-semibold text-[#D1D0D0] tracking-tight">₹299</span>
                <span className="text-sm text-[rgba(209,208,208,0.4)] mb-1">/month</span>
              </div>
              <p className="mt-3 text-xs text-[rgba(209,208,208,0.4)]">For professionals who share files regularly</p>
            </div>
            <ul className="space-y-3.5 mb-8">
              {['Unlimited files', 'Up to 1 GB per file', 'Custom expiration dates', 'Password protection', 'Full activity history', 'Priority support'].map(f => (
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

        {/* Security note */}
        <div className="mt-16 flex items-center justify-center gap-2.5 text-xs text-[rgba(209,208,208,0.35)]">
          <Shield size={12} className="text-[rgba(209,208,208,0.3)]" />
          <span>All plans include AES-256-GCM encryption, zero-knowledge key delivery, and instant revocation.</span>
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <p className="text-sm text-[rgba(209,208,208,0.4)] mb-4">Questions about pricing?</p>
          <div className="flex flex-wrap gap-4 items-center justify-center">
            <Link to="/auth/signup">
              <Button variant="primary" size="md" rightIcon={<ArrowRight size={14} />}>
                Get started
              </Button>
            </Link>
            <Link to="/security">
              <Button variant="ghost" size="md">
                View security docs
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </main>
  </div>
)

export default PricingPage
