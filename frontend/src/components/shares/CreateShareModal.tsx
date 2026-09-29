/**
 * CreateShareModal — configures and creates a secure share link for a file.
 *
 * Implements client-side key wrapping:
 * 1. Derives a Key Encryption Key (KEK) from a share passphrase and fresh salt
 *    using PBKDF2-HMAC-SHA-256 (600,000 iterations).
 * 2. Wraps the File Encryption Key (FEK) using AES-256-GCM with a fresh 12-byte nonce.
 * 3. Uploads only the wrapped FEK, salt, iterations, algorithm, and nonces.
 * 4. Generates a clean URL: /s/<share-id> containing NO key, IV, or secret.
 * 5. Provides the share passphrase for out-of-band delivery to the recipient.
 */
import React, { useState } from 'react'
import {
  Shield, Clock, Download, Eye, Lock,
  Copy, Check, AlertTriangle, Key, RefreshCw
} from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Badge } from '../ui/Badge'
import { useToast } from '../../contexts/ToastContext'
import { createShare } from '../../lib/shares'
import {
  generateSalt,
  generateSecurePassphrase,
  deriveKEK,
  wrapFEK,
  bytesToHex,
  hashSharePassword,
  DEFAULT_KDF_ITERATIONS,
  KDF_ALGORITHM,
} from '../../lib/crypto'

interface Props {
  fileId: string
  onClose: () => void
  /** Encryption key (base64url) from the upload step. When absent the user must paste the key. */
  encryptionKey?: string
}

type Step = 'configure' | 'created'

interface ShareResult {
  token: string
  shareUrl: string      // clean URL: /s/{token} — no keys, IVs, or secrets
  passphrase: string    // share passphrase for out-of-band delivery
}

const EXPIRY_OPTIONS = [
  { label: '1 hour',   value: 1 },
  { label: '24 hours', value: 24 },
  { label: '7 days',   value: 168 },
  { label: '30 days',  value: 720 },
  { label: 'Never',    value: null },
]

const DOWNLOAD_LIMIT_OPTIONS = [
  { label: '1 download',    value: 1 },
  { label: '5 downloads',   value: 5 },
  { label: '10 downloads',  value: 10 },
  { label: '25 downloads',  value: 25 },
  { label: 'Unlimited',     value: 0 },
]

export const CreateShareModal: React.FC<Props> = ({ fileId, onClose, encryptionKey }) => {
  const [step, setStep] = useState<Step>('configure')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ShareResult | null>(null)

  // Configuration state
  const [expiryHours, setExpiryHours] = useState<number | null>(168) // 7 days default
  const [maxDownloads, setMaxDownloads] = useState(5)
  const [accessMode, setAccessMode] = useState<'download' | 'view_only'>('download')
  
  // Passphrase state (for key wrapping)
  const [passphrase, setPassphrase] = useState<string>(() => generateSecurePassphrase())
  const [showPassphrase, setShowPassphrase] = useState(false)

  // Manual key input — used when re-sharing an existing file and encryptionKey
  // prop was not passed (key not available from this session's upload).
  const [manualKey, setManualKey] = useState('')

  // Copy states
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedPassphrase, setCopiedPassphrase] = useState(false)
  const [copiedAll, setCopiedAll] = useState(false)

  const toast = useToast()

  // The effective key: prop if present, otherwise manual input
  const effectiveKey = encryptionKey || manualKey.trim()
  const needsKeyInput = !encryptionKey

  const handleRegeneratePassphrase = () => {
    setPassphrase(generateSecurePassphrase())
    toast('info', 'Passphrase refreshed', 'A new secure passphrase was generated.')
  }

  const handleCreate = async () => {
    const cleanPassphrase = passphrase.trim()
    if (!cleanPassphrase || cleanPassphrase.length < 6) {
      toast('error', 'Passphrase too short', 'Enter at least 6 characters for the share passphrase.')
      return
    }

    if (!effectiveKey) {
      toast('error', 'Encryption key required', 'Paste the original file encryption key from your upload.')
      return
    }

    setLoading(true)
    try {
      // 1. Generate fresh random salt (16 bytes)
      const salt = generateSalt(16)
      const saltHex = bytesToHex(salt)

      // 2. Derive Key Encryption Key (KEK) using PBKDF2-HMAC-SHA-256 (600,000 iterations)
      const kek = await deriveKEK(cleanPassphrase, salt, DEFAULT_KDF_ITERATIONS)

      // 3. Authenticated AES-256-GCM key wrapping with fresh 12-byte wrapping IV
      const { wrappedFekBase64, wrappingIvHex } = await wrapFEK(effectiveKey, kek)

      // 4. Derive zero-knowledge auth hash for rate-limited backend verification
      const passwordHash = await hashSharePassword(cleanPassphrase, saltHex)

      // 5. Upload only wrapped metadata; plaintext key or passphrase is never transmitted
      const res = await createShare({
        fileId,
        expiresInHours: expiryHours,
        maxDownloads: maxDownloads,
        accessMode,
        passwordHash,
        wrappedFek: wrappedFekBase64,
        kdfSalt: saltHex,
        kdfIterations: DEFAULT_KDF_ITERATIONS,
        kdfAlgorithm: KDF_ALGORITHM,
        wrappingIv: wrappingIvHex,
      })

      // Clean share URL: strictly /s/{token} with NO key or fragment
      const shareUrl = `${window.location.origin}/s/${res.token}`

      setResult({
        token: res.token,
        shareUrl,
        passphrase: cleanPassphrase,
      })
      setStep('created')
    } catch (e) {
      toast('error', 'Failed to create share', e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = async (text: string, type: 'link' | 'passphrase' | 'all') => {
    try {
      await navigator.clipboard.writeText(text)
      if (type === 'link') {
        setCopiedLink(true)
        setTimeout(() => setCopiedLink(false), 2000)
        toast('success', 'Share link copied', 'The URL is clean and safe to share.')
      } else if (type === 'passphrase') {
        setCopiedPassphrase(true)
        setTimeout(() => setCopiedPassphrase(false), 2000)
        toast('success', 'Passphrase copied', 'Provide this passphrase separately to the recipient.')
      } else {
        setCopiedAll(true)
        setTimeout(() => setCopiedAll(false), 2000)
        toast('success', 'Link & passphrase copied', 'Both details copied to clipboard.')
      }
    } catch {
      toast('error', 'Copy failed', 'Please copy the text manually.')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={step === 'configure' ? 'Create secure share' : 'Share link created'}
      description={
        step === 'configure'
          ? 'Configure access controls and key wrapping for your secure file link.'
          : 'Your secure link is ready. Provide the link and the passphrase separately.'
      }
      size="md"
    >
      {step === 'configure' ? (
        <div className="space-y-6 pt-1">
          {/* Expiry */}
          <div>
            <label className="block text-xs font-medium text-[rgba(209,208,208,0.5)] mb-2 uppercase tracking-wider">
              <Clock size={11} className="inline mr-1.5 opacity-60" />
              Expiration
            </label>
            <div className="flex flex-wrap gap-2">
              {EXPIRY_OPTIONS.map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => setExpiryHours(opt.value)}
                  className={`px-3 py-1.5 rounded text-xs border transition-all duration-150 ${
                    expiryHours === opt.value
                      ? 'border-[rgba(209,208,208,0.4)] bg-[rgba(209,208,208,0.08)] text-[#D1D0D0]'
                      : 'border-[rgba(209,208,208,0.1)] text-[rgba(209,208,208,0.4)] hover:border-[rgba(209,208,208,0.2)] hover:text-[rgba(209,208,208,0.6)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Download limit */}
          <div>
            <label className="block text-xs font-medium text-[rgba(209,208,208,0.5)] mb-2 uppercase tracking-wider">
              <Download size={11} className="inline mr-1.5 opacity-60" />
              Download limit
            </label>
            <div className="flex flex-wrap gap-2">
              {DOWNLOAD_LIMIT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setMaxDownloads(opt.value)}
                  className={`px-3 py-1.5 rounded text-xs border transition-all duration-150 ${
                    maxDownloads === opt.value
                      ? 'border-[rgba(209,208,208,0.4)] bg-[rgba(209,208,208,0.08)] text-[#D1D0D0]'
                      : 'border-[rgba(209,208,208,0.1)] text-[rgba(209,208,208,0.4)] hover:border-[rgba(209,208,208,0.2)] hover:text-[rgba(209,208,208,0.6)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Access mode */}
          <div>
            <label className="block text-xs font-medium text-[rgba(209,208,208,0.5)] mb-2 uppercase tracking-wider">
              <Eye size={11} className="inline mr-1.5 opacity-60" />
              Access mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setAccessMode('download')}
                className={`px-3 py-3 rounded border text-left transition-all duration-150 ${
                  accessMode === 'download'
                    ? 'border-[rgba(209,208,208,0.4)] bg-[rgba(209,208,208,0.06)]'
                    : 'border-[rgba(209,208,208,0.08)] hover:border-[rgba(209,208,208,0.2)]'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Download size={12} className={accessMode === 'download' ? 'text-[#D1D0D0]' : 'text-[rgba(209,208,208,0.4)]'} />
                  <span className={`text-xs font-medium ${accessMode === 'download' ? 'text-[#D1D0D0]' : 'text-[rgba(209,208,208,0.4)]'}`}>
                    Download
                  </span>
                </div>
                <p className="text-[11px] text-[rgba(209,208,208,0.3)]">Recipient can save the file</p>
              </button>
              <button
                onClick={() => setAccessMode('view_only')}
                className={`px-3 py-3 rounded border text-left transition-all duration-150 ${
                  accessMode === 'view_only'
                    ? 'border-[rgba(209,208,208,0.4)] bg-[rgba(209,208,208,0.06)]'
                    : 'border-[rgba(209,208,208,0.08)] hover:border-[rgba(209,208,208,0.2)]'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Eye size={12} className={accessMode === 'view_only' ? 'text-[#D1D0D0]' : 'text-[rgba(209,208,208,0.4)]'} />
                  <span className={`text-xs font-medium ${accessMode === 'view_only' ? 'text-[#D1D0D0]' : 'text-[rgba(209,208,208,0.4)]'}`}>
                    View only
                  </span>
                </div>
                <p className="text-[11px] text-[rgba(209,208,208,0.3)]">Read-only, no download</p>
              </button>
            </div>
          </div>

          {/* Key Wrapping Passphrase */}
          <div className="p-3.5 rounded border border-[rgba(109,191,140,0.2)] bg-[rgba(109,191,140,0.03)] space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[rgba(109,191,140,0.9)] uppercase tracking-wider flex items-center gap-1.5">
                <Lock size={11} className="text-[#6dbf8c]" />
                Share Passphrase (Required)
              </label>
              <button
                type="button"
                onClick={handleRegeneratePassphrase}
                className="text-[11px] text-[rgba(109,191,140,0.7)] hover:text-[#6dbf8c] flex items-center gap-1 transition-colors"
                title="Generate new passphrase"
              >
                <RefreshCw size={11} />
                Regenerate
              </button>
            </div>
            <div className="relative">
              <Input
                type={showPassphrase ? 'text' : 'password'}
                placeholder="Enter or generate a share passphrase…"
                value={passphrase}
                onChange={e => setPassphrase(e.target.value)}
                leftIcon={<Key size={14} />}
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[rgba(209,208,208,0.4)] hover:text-[rgba(209,208,208,0.7)] transition-colors"
              >
                {showPassphrase ? 'hide' : 'show'}
              </button>
            </div>
            <p className="text-[11px] text-[rgba(209,208,208,0.4)] leading-relaxed">
              The File Encryption Key is wrapped in your browser with AES-256-GCM using PBKDF2 (600,000 rounds). The server never sees the key or your passphrase.
            </p>
          </div>

          {/* Manual key input — shown when re-sharing an existing file */}
          {needsKeyInput && (
            <div className="p-3.5 rounded border border-[rgba(232,192,123,0.25)] bg-[rgba(232,192,123,0.05)] space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle size={12} className="text-[#e8c07b] shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[rgba(232,192,123,0.9)]">Original File Encryption Key Required</p>
                  <p className="text-[11px] text-[rgba(232,192,123,0.6)] leading-relaxed">
                    VaultKey never stores your keys. Paste the key from your original upload to wrap it with this new share passphrase.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Key size={12} className="text-[rgba(232,192,123,0.5)] shrink-0" />
                <input
                  type="text"
                  placeholder="Paste original encryption key here…"
                  value={manualKey}
                  onChange={e => setManualKey(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs font-mono bg-[#0a0a0a] border border-[rgba(232,192,123,0.2)] rounded text-[#D1D0D0] focus:outline-none focus:border-[rgba(232,192,123,0.4)] placeholder:text-[rgba(209,208,208,0.2)]"
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" size="md" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              className="flex-1"
              leftIcon={<Shield size={14} />}
              onClick={handleCreate}
              loading={loading}
            >
              Create share link
            </Button>
          </div>
        </div>
      ) : result ? (
        <div className="space-y-5 pt-1">
          {/* Success indicator */}
          <div className="flex items-center gap-3 p-4 rounded border border-[rgba(109,191,140,0.2)] bg-[rgba(109,191,140,0.05)]">
            <div className="relative w-2 h-2 shrink-0">
              <div className="w-2 h-2 rounded-full bg-[#6dbf8c]" />
              <div className="absolute inset-0 rounded-full bg-[#6dbf8c] animate-ping opacity-30" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[rgba(109,191,140,0.9)]">Share link created</p>
              <p className="text-[11px] text-[rgba(109,191,140,0.5)] mt-0.5">Active and ready to share</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {expiryHours && (
                <Badge variant="muted" size="sm">
                  <Clock size={9} className="mr-1" />
                  {expiryHours < 24 ? `${expiryHours}h` : `${expiryHours / 24}d`}
                </Badge>
              )}
              {accessMode === 'view_only' && <Badge variant="warning" size="sm">View only</Badge>}
            </div>
          </div>

          {/* Clean Share Link */}
          <div>
            <p className="text-[11px] font-medium text-[rgba(209,208,208,0.4)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Shield size={11} className="text-[#6dbf8c]" />
              Clean Share Link (No Secret Key in URL)
            </p>
            <div className="flex items-center gap-2 p-3 rounded border border-[rgba(209,208,208,0.12)] bg-[#0d0d0d]">
              <span className="flex-1 font-mono text-[11px] text-[#D1D0D0] truncate select-all">
                {result.shareUrl}
              </span>
              <button
                onClick={() => copyToClipboard(result.shareUrl, 'link')}
                className="shrink-0 p-1.5 rounded text-[rgba(209,208,208,0.4)] hover:text-[#D1D0D0] hover:bg-[rgba(209,208,208,0.06)] transition-all"
                title="Copy share link"
              >
                {copiedLink ? <Check size={13} className="text-[#6dbf8c]" /> : <Copy size={13} />}
              </button>
            </div>
            <p className="text-[11px] text-[rgba(209,208,208,0.4)] mt-1.5">
              Contains only a random share ID. The encryption key is NOT in the URL.
            </p>
          </div>

          {/* Share Passphrase */}
          <div>
            <p className="text-[11px] font-medium text-[rgba(209,208,208,0.4)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Lock size={11} className="text-[#e8c07b]" />
              Share Passphrase (Provide to Recipient)
            </p>
            <div className="flex items-center gap-2 p-3 rounded border border-[rgba(232,192,123,0.2)] bg-[#0d0d0d]">
              <span className="flex-1 font-mono text-xs text-[#e8c07b] truncate select-all">
                {result.passphrase}
              </span>
              <button
                onClick={() => copyToClipboard(result.passphrase, 'passphrase')}
                className="shrink-0 p-1.5 rounded text-[rgba(209,208,208,0.4)] hover:text-[#D1D0D0] hover:bg-[rgba(209,208,208,0.06)] transition-all"
                title="Copy passphrase"
              >
                {copiedPassphrase ? <Check size={13} className="text-[#6dbf8c]" /> : <Copy size={13} />}
              </button>
            </div>
            <p className="text-[11px] text-[rgba(232,192,123,0.7)] mt-1.5">
              The recipient will enter this passphrase in their browser to unwrap the encryption key.
            </p>
          </div>

          {/* Copy Both Option */}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="w-full text-xs"
              leftIcon={copiedAll ? <Check size={12} className="text-[#6dbf8c]" /> : <Copy size={12} />}
              onClick={() => copyToClipboard(`VaultKey Share:\nLink: ${result.shareUrl}\nPassphrase: ${result.passphrase}`, 'all')}
            >
              {copiedAll ? 'Copied Both to Clipboard' : 'Copy Link & Passphrase'}
            </Button>
          </div>

          {/* Out-of-band Delivery Guidance */}
          <div className="p-3.5 rounded border border-[rgba(109,191,140,0.15)] bg-[rgba(109,191,140,0.03)] space-y-1.5">
            <p className="text-xs font-medium text-[rgba(109,191,140,0.9)]">Zero-Knowledge Out-of-Band Delivery</p>
            <p className="text-[11px] text-[rgba(209,208,208,0.5)] leading-relaxed">
              For maximum security, share the link and passphrase through different channels (e.g., send the link via email and the passphrase via SMS or Signal).
            </p>
          </div>

          {/* Security summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Key Wrapping', value: 'AES-GCM (KEK)', good: true },
              { label: 'KDF', value: 'PBKDF2 (600k)', good: true },
              { label: 'Downloads', value: maxDownloads === 0 ? 'Unlimited' : `Max ${maxDownloads}`, good: maxDownloads > 0 },
            ].map(item => (
              <div key={item.label} className="p-3 rounded border border-[rgba(209,208,208,0.06)] bg-[#0d0d0d] text-center">
                <p className="text-[11px] text-[rgba(209,208,208,0.35)] mb-1">{item.label}</p>
                <p className={`text-xs font-medium ${item.good ? 'text-[rgba(109,191,140,0.8)]' : 'text-[rgba(209,208,208,0.5)]'}`}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          {/* Done */}
          <Button variant="primary" size="md" className="w-full" leftIcon={<Shield size={14} />} onClick={onClose}>
            Done
          </Button>
        </div>
      ) : null}
    </Modal>
  )
}
