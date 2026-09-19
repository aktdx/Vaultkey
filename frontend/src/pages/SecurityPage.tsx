import React from 'react'
import { Link } from 'react-router-dom'
import { Shield, Lock, Eye, ShieldOff, Server, Globe, ArrowRight } from 'lucide-react'
import { LandingNav } from '../components/layout/LandingNav'

interface ArchStep {
  from: string
  to: string
  label: string
  detail: string
}

const archSteps: ArchStep[] = [
  { from: 'Browser', to: 'Web Crypto API', label: 'File selected', detail: 'File read into ArrayBuffer in the browser — never leaves the tab until encrypted' },
  { from: 'Web Crypto API', to: 'Encrypted Blob', label: 'AES-256-GCM encryption', detail: 'generateKey() → random 256-bit key + 96-bit IV → encrypt() → authenticated ciphertext' },
  { from: 'Encrypted Blob', to: 'Supabase Storage', label: 'Encrypted upload', detail: 'Only the ciphertext (with IV prepended) is transmitted. The key is never sent.' },
  { from: 'VaultKey', to: 'Share URL', label: 'Zero-knowledge key delivery', detail: 'Key is appended to the URL fragment: /s/{token}#key={base64url_key}. Fragments are not sent in HTTP requests.' },
  { from: 'Recipient Browser', to: 'Decrypted File', label: 'Client-side decryption', detail: 'Fragment key is parsed → AES-256-GCM decryption in browser → file downloaded locally' },
]

const SecurityPage: React.FC = () => (
  <div className="min-h-screen bg-black text-[#D1D0D0]">
    <LandingNav />

    <main className="pt-32 pb-24 px-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-16">
          <span className="text-[10px] tracking-[0.16em] uppercase text-[rgba(209,208,208,0.35)] mb-4 block">Security architecture</span>
          <h1 className="font-semibold text-[#D1D0D0] mb-4" style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: '1.0', letterSpacing: '-0.035em' }}>
            How VaultKey protects your files
          </h1>
          <p className="text-base text-[rgba(209,208,208,0.5)] leading-relaxed max-w-xl">
            An honest account of the security architecture. Every claim made in this product corresponds to a real implementation.
          </p>
        </div>

        {/* Architecture flow */}
        <section className="mb-20">
          <h2 className="text-sm font-medium text-[#D1D0D0] mb-8 tracking-wide">Encryption architecture</h2>
          <div className="space-y-0">
            {archSteps.map((step, i) => (
              <div key={i} className="relative flex gap-6">
                {/* Left: step number + connector */}
                <div className="flex flex-col items-center">
                  <div className="w-7 h-7 rounded-sm border border-[rgba(209,208,208,0.15)] bg-[#0e0e0e] flex items-center justify-center text-[10px] font-mono text-[rgba(209,208,208,0.4)] shrink-0">
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  {i < archSteps.length - 1 && (
                    <div className="w-px flex-1 mt-2 mb-0 bg-[rgba(209,208,208,0.07)]" style={{ minHeight: 32 }} />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pb-8">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-medium text-[#D1D0D0]">{step.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[rgba(209,208,208,0.4)] mb-2 font-mono">
                    <span>{step.from}</span>
                    <span>→</span>
                    <span className="text-[rgba(209,208,208,0.6)]">{step.to}</span>
                  </div>
                  <p className="text-sm text-[rgba(209,208,208,0.5)] leading-relaxed">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Security features */}
        <section className="mb-20">
          <h2 className="text-sm font-medium text-[#D1D0D0] mb-6 tracking-wide">Security controls</h2>
          <div className="space-y-3">
            {[
              {
                icon: <Lock size={15} />,
                title: 'AES-256-GCM encryption',
                desc: 'Files are encrypted using the Web Crypto API with AES-256-GCM — the same algorithm used by Signal, WhatsApp, and TLS 1.3. Each file receives a unique randomly-generated key and IV.',
                status: 'Live',
              },
              {
                icon: <Shield size={15} />,
                title: 'Zero-knowledge key delivery',
                desc: 'Decryption keys are placed in the URL fragment (#key=...). URL fragments are never included in HTTP requests by browsers, meaning the key is never transmitted to VaultKey servers.',
                status: 'Live',
              },
              {
                icon: <Eye size={15} />,
                title: 'Atomic download limits',
                desc: 'Download counters are updated using atomic database operations, preventing race conditions where multiple simultaneous requests could bypass the configured download limit.',
                status: 'Live',
              },
              {
                icon: <Globe size={15} />,
                title: 'Server-side expiration validation',
                desc: 'Share expiration is validated on the server for every access request. Client-side checks are cosmetic only — expiration is enforced at the API level.',
                status: 'Live',
              },
              {
                icon: <ShieldOff size={15} />,
                title: 'Instant revocation',
                desc: 'Revoking a share immediately marks it as inaccessible in the database. Subsequent requests receive a 403 before any data is returned.',
                status: 'Live',
              },
              {
                icon: <Server size={15} />,
                title: 'Share password protection',
                desc: 'Share passwords are never stored in plaintext. PBKDF2-SHA256 with 100,000 iterations and a random salt is used. Only the derived hash is stored.',
                status: 'Live',
              },
            ].map((f, i) => (
              <div key={i} className="flex gap-4 p-5 rounded-md border border-[rgba(209,208,208,0.08)] bg-[#090909]">
                <div className="text-[rgba(209,208,208,0.4)] mt-0.5 shrink-0">{f.icon}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="text-sm font-medium text-[#D1D0D0]">{f.title}</span>
                    <span className="text-[9px] tracking-wider text-[rgba(109,191,140,0.7)] bg-[rgba(109,191,140,0.08)] border border-[rgba(109,191,140,0.15)] px-1.5 py-0.5 rounded-sm font-medium">
                      {f.status}
                    </span>
                  </div>
                  <p className="text-xs text-[rgba(209,208,208,0.45)] leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Honest limitations */}
        <section className="mb-20">
          <h2 className="text-sm font-medium text-[#D1D0D0] mb-4 tracking-wide">Honest limitations</h2>
          <div className="p-5 rounded-md border border-[rgba(209,208,208,0.08)] bg-[#090909] space-y-3">
            {[
              'If you share the URL (including its fragment) publicly, anyone with it can decrypt the file.',
              'VaultKey does not encrypt file metadata such as filename, size, or MIME type in the current version.',
              'Supabase has access to the encrypted ciphertext, but not the decryption key.',
              'If a recipient copies the decryption key from the URL fragment, they can decrypt the file even after revocation (from locally cached data).',
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-[10px] font-mono text-[rgba(209,208,208,0.25)] mt-0.5 shrink-0">—</span>
                <p className="text-sm text-[rgba(209,208,208,0.5)]">{item}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <div className="flex gap-4">
          <Link to="/auth/signup">
            <button className="inline-flex items-center gap-2 h-10 px-5 text-sm font-medium bg-[#D1D0D0] text-black rounded hover:bg-white transition-colors">
              Get started <ArrowRight size={14} />
            </button>
          </Link>
          <Link to="/">
            <button className="inline-flex items-center gap-2 h-10 px-5 text-sm text-[rgba(209,208,208,0.6)] border border-[rgba(209,208,208,0.15)] rounded hover:text-[#D1D0D0] hover:border-[rgba(209,208,208,0.3)] transition-all">
              Back to home
            </button>
          </Link>
        </div>
      </div>
    </main>
  </div>
)

export default SecurityPage
