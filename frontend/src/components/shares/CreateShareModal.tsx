/**
 * CreateShareModal — configures and creates a secure share link for a file.
 *
 * After the share is created, it shows the share URL (without the #key= fragment
 * for zero-knowledge delivery) and the full secure URL (with the fragment).
 * The user is instructed to copy the full URL and share appropriately.
 */
import React, { useState } from 'react'
import {
  Shield, Clock, Download, Eye, Lock,
  Copy, Check, AlertTriangle, Key
} from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Toggle } from '../ui/Toggle'
import { Badge } from '../ui/Badge'
import { useToast } from '../../contexts/ToastContext'
import { createShare } from '../../lib/shares'
import { buildShareUrl } from '../../lib/utils'

interface Props {
  fileId: string
  onClose: () => void
  /** Encryption key (base64url) from the upload step. When provided the full
   *  #key= URL is built automatically. When absent the user must paste the key. */
  encryptionKey?: string
}

type Step = 'configure' | 'created'

interface ShareResult {
  token: string
  shareUrl: string      // just the path /s/{token} — no key
  secureUrl: string     // full URL with #key= fragment (if key is available)
  hasKey: boolean
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
  const [passwordEnabled, setPasswordEnabled] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Manual key input — used when re-sharing an existing file and encryptionKey
  // prop was not passed (key not available from this session's upload).
  const [manualKey, setManualKey] = useState('')

  // Copy state
  const [copiedFull, setCopiedFull] = useState(false)
  const [copiedBase, setCopiedBase] = useState(false)

  const toast = useToast()

  // The effective key: prop if present, otherwise manual input
  const effectiveKey = encryptionKey || manualKey.trim()
  const needsKeyInput = !encryptionKey

  const handleCreate = async () => {
    if (passwordEnabled && password.length < 4) {
      toast('error', 'Password too short', 'Enter at least 4 characters.')
      return
    }

    // Validate the key is present — zero-knowledge, key is never sent to server
    if (!effectiveKey) {
      toast('error', 'Encryption key required', 'Paste the 64-character key from your original upload.')
      return
    }

    setLoading(true)
    try {
      const res = await createShare({
        fileId,
        expiresInHours: expiryHours,
        maxDownloads: maxDownloads,
        accessMode,
        password: passwordEnabled ? password : null,
      })

      // Build the full zero-knowledge URL with the #key= fragment.
      // buildShareUrl produces: {origin}/s/{token}#key={encryptionKey}
      const shareUrl = `${window.location.origin}${res.shareUrl}`
      const secureUrl = buildShareUrl(res.token, effectiveKey)

      setResult({
        token: res.token,
        shareUrl,
        secureUrl,
        hasKey: true,
      })
      setStep('created')
    } catch (e) {
      toast('error', 'Failed to create share', e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = async (text: string, type: 'full' | 'base') => {
    try {
      await navigator.clipboard.writeText(text)
      if (type === 'full') {
        setCopiedFull(true)
        setTimeout(() => setCopiedFull(false), 2000)
        toast('success', 'Secure URL copied', 'Send this full link to your recipient.')
      } else {
        setCopiedBase(true)
        setTimeout(() => setCopiedBase(false), 2000)
        toast('success', 'Link copied', 'This link alone cannot decrypt the file.')
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
          ? 'Configure access controls for your secure file link.'
          : 'Your secure link is ready. Save the encryption key — it cannot be recovered.'
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

          {/* Password protection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-medium text-[rgba(209,208,208,0.5)] uppercase tracking-wider flex items-center gap-1.5">
                <Lock size={11} className="opacity-60" />
                Password protection
              </label>
              <Toggle checked={passwordEnabled} onChange={setPasswordEnabled} />
            </div>
            {passwordEnabled && (
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Set a share password…"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  leftIcon={<Lock size={14} />}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[rgba(209,208,208,0.4)] hover:text-[rgba(209,208,208,0.7)] transition-colors"
                >
                  {showPassword ? 'hide' : 'show'}
                </button>
              </div>
            )}
          </div>

          {/* Manual key input — shown when re-sharing an existing file
               where the key was not passed from this session's upload.
               VaultKey never stores encryption keys; if it was lost, the
               file cannot be decrypted or shared by anyone including the owner. */}
          {needsKeyInput && (
            <div className="p-3.5 rounded border border-[rgba(232,192,123,0.25)] bg-[rgba(232,192,123,0.05)] space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle size={12} className="text-[#e8c07b] shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[rgba(232,192,123,0.9)]">Encryption key required</p>
                  <p className="text-[11px] text-[rgba(232,192,123,0.6)] leading-relaxed">
                    VaultKey never stores your key. Paste the key from your original upload to build the share link.
                  </p>
                  <p className="text-[11px] text-[rgba(232,192,123,0.8)] font-semibold">
                    ⚠ If the key was lost, this file cannot be decrypted or shared by anyone — including you.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Key size={12} className="text-[rgba(232,192,123,0.5)] shrink-0" />
                <input
                  type="text"
                  placeholder="Paste encryption key here…"
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
              {passwordEnabled && <Badge variant="info" size="sm">Password</Badge>}
              {accessMode === 'view_only' && <Badge variant="warning" size="sm">View only</Badge>}
            </div>
          </div>

          {/* Secure URL with key — or key warning if somehow missing */}
          <div>
            <p className="text-[11px] font-medium text-[rgba(209,208,208,0.4)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Key size={10} />
              Secure link (with decryption key)
            </p>
            <div className="flex items-center gap-2 p-3 rounded border border-[rgba(109,191,140,0.15)] bg-[#0d0d0d]">
              <span className="flex-1 font-mono text-[11px] text-[rgba(209,208,208,0.6)] truncate">
                {result.secureUrl}
              </span>
              <button
                onClick={() => copyToClipboard(result.secureUrl, 'full')}
                className="shrink-0 p-1.5 rounded text-[rgba(209,208,208,0.3)] hover:text-[rgba(209,208,208,0.7)] hover:bg-[rgba(209,208,208,0.06)] transition-all"
                title="Copy secure URL"
              >
                {copiedFull ? <Check size={13} className="text-[#6dbf8c]" /> : <Copy size={13} />}
              </button>
            </div>
            <p className="text-[11px] text-[rgba(109,191,140,0.5)] mt-1.5">
              The #key= fragment is never sent to the server — it exists only in the browser.
            </p>
          </div>

          {/* Key warning */}
          <div className="p-4 rounded border border-[rgba(232,123,123,0.2)] bg-[rgba(232,123,123,0.05)]">
            <div className="flex items-start gap-3">
              <AlertTriangle size={13} className="text-[#e87b7b] shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="text-xs font-medium text-[rgba(232,123,123,0.9)]">Save this link now</p>
                <p className="text-[11px] text-[rgba(232,123,123,0.6)] leading-relaxed">
                  The encryption key was generated during upload and shown only once. The full secure link
                  above embeds the key in the URL fragment — copy and send it to the recipient directly.
                  Do not share the base URL without the #key= fragment.
                </p>
                <p className="text-[11px] text-[rgba(232,123,123,0.5)]">
                  VaultKey never stores encryption keys. A lost key means permanent inaccessibility.
                </p>
              </div>
            </div>
          </div>

          {/* Security summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Encryption', value: 'AES-256-GCM', good: true },
              { label: 'Expiry', value: expiryHours ? (expiryHours < 24 ? `${expiryHours}h` : `${expiryHours / 24}d`) : 'Never', good: !!expiryHours },
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
