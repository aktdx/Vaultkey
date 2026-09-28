import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Upload, Lock, Share2, Eye, ShieldOff, Shield } from 'lucide-react'
import { LandingNav } from '../components/layout/LandingNav'
import { Button } from '../components/ui/Button'

interface StepProps {
  number: string
  label: string
  title: string
  description: string
  icon: React.ReactNode
}

const Step: React.FC<StepProps> = ({ number, label, title, description, icon }) => (
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
      <h3 className="text-lg font-medium text-[#D1D0D0] mb-2.5 tracking-tight">{title}</h3>
      <p className="text-sm text-[rgba(209,208,208,0.5)] leading-[1.75] max-w-lg">{description}</p>
    </div>
  </div>
)

const HowItWorksPage: React.FC = () => (
  <div className="min-h-screen bg-black text-[#D1D0D0]">
    <LandingNav />

    <main className="pt-32 pb-32 px-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-20">
          <span className="text-[10px] tracking-[0.16em] uppercase text-[rgba(209,208,208,0.35)] mb-5 block">
            The VaultKey Workflow
          </span>
          <h1
            className="font-semibold text-[#D1D0D0] mb-6"
            style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: '1.05', letterSpacing: '-0.035em' }}
          >
            From upload to access,<br />every step is secured.
          </h1>
          <p className="text-base text-[rgba(209,208,208,0.5)] leading-[1.75] max-w-xl">
            VaultKey uses browser-side AES-256-GCM encryption so your files never leave your device unencrypted. Here is exactly how it works.
          </p>
        </div>

        {/* Steps */}
        <div className="relative mb-20">
          <Step
            number="01"
            label="Upload"
            title="Select your file"
            description="Drag and drop or select any file. VaultKey begins the security process immediately in your browser."
            icon={<Upload size={16} />}
          />
          <Step
            number="02"
            label="Encrypt"
            title="Browser-side AES-256-GCM encryption"
            description="Your file is encrypted locally using the Web Crypto API before it leaves your device. The encryption key never touches our servers."
            icon={<Lock size={16} />}
          />
          <Step
            number="03"
            label="Protect"
            title="Configure your access controls"
            description="Set an expiration date, download limit, and optional password. You decide who can access your file and for how long."
            icon={<Shield size={16} />}
          />
          <Step
            number="04"
            label="Share"
            title="Receive a secure sharing link"
            description="A unique token is generated. The decryption key is embedded in the URL fragment — it's never transmitted to our servers."
            icon={<Share2 size={16} />}
          />
          <Step
            number="05"
            label="Monitor"
            title="Track every access event"
            description="See who accessed your file, when, and from where. Every download attempt is logged in real time."
            icon={<Eye size={16} />}
          />
          <Step
            number="06"
            label="Revoke"
            title="Instant revocation"
            description="Changed your mind? Revoke access instantly. The secure link becomes permanently invalid — no questions asked."
            icon={<ShieldOff size={16} />}
          />
        </div>

        {/* CTA */}
        <div className="flex flex-wrap gap-4 items-center">
          <Link to="/auth/signup">
            <Button variant="primary" size="md" rightIcon={<ArrowRight size={14} />}>
              Get started free
            </Button>
          </Link>
          <Link to="/security">
            <Button variant="ghost" size="md">
              Read security docs
            </Button>
          </Link>
        </div>
      </div>
    </main>
  </div>
)

export default HowItWorksPage
