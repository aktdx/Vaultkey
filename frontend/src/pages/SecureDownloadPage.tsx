/**
 * SecureDownloadPage — recipient-facing share access page.
 *
 * Implements client-side key unwrapping and decryption:
 *   • Recipient visits clean URL: /s/<token> (no secret in URL).
 *   • Recipient enters share passphrase out-of-band.
 *   • Browser derives KEK from passphrase + salt (PBKDF2-HMAC-SHA-256, 600,000 rounds).
 *   • Browser unwraps FEK locally via authenticated AES-256-GCM.
 *   • If passphrase or tag is invalid, unwrap fails locally before any sensitive action.
 *   • Decrypts file locally in-browser with unwrapped FEK.
 *   • Isolated legacy support: handles legacy #key= fragment links if wrapped_fek is absent.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  Shield, Lock, Clock, Hash,
  Download, CheckCircle2, AlertCircle, Eye, EyeOff, Key,
} from 'lucide-react'
import {
  getShareByToken,
  downloadAndDecrypt,
  viewAndDecrypt,
  unwrapShareFEK,
} from '../lib/shares'
import { apiRecordAccessAttempt, apiReportBlockedAction } from '../lib/api'
import { extractLegacyKeyFromFragment } from '../lib/utils'
import { hashSharePassword, exportKey } from '../lib/crypto'
import { createHandoffNonce, createSecureViewerDeepLink, transferKeyToSecureViewer } from '../lib/secureViewerHandoff'
import { ViewOnlyViewer } from '../components/shares/ViewOnlyViewer'
import type { ApiAccessCheck } from '../lib/api'

// ─── Shell layout ─────────────────────────────────────────────────────────────

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4 py-16">
    <div className="absolute inset-0 pointer-events-none opacity-20" aria-hidden="true"
      style={{ backgroundImage: 'radial-gradient(circle, rgba(209,208,208,0.05) 1px, transparent 1px)', backgroundSize: '32px 32px' }}
    />
    <div className="relative z-10 w-full max-w-md">
      <div className="flex items-center justify-center gap-2 mb-10">
        <Shield size={16} className="text-[rgba(209,208,208,0.5)]" />
        <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-[rgba(209,208,208,0.4)]">VaultKey</span>
      </div>
      {children}
    </div>
  </div>
)

// ─── Component ────────────────────────────────────────────────────────────────

export function SecureDownloadPage() {
  const { token } = useParams<{ token: string }>()

  const [accessData, setAccessData] = useState<ApiAccessCheck | null>(null)
  const [loading, setLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [downloadComplete, setDownloadComplete] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // View-only viewer state
  const [viewerBlob, setViewerBlob] = useState<Blob | null>(null)
  const [viewerFilename, setViewerFilename] = useState('')
  const [viewerMime, setViewerMime] = useState('')
  const [showViewer, setShowViewer] = useState(false)
  const [launchingSecureViewer, setLaunchingSecureViewer] = useState(false)
  const [secureViewerMessage, setSecureViewerMessage] = useState('')
  const initialAccessToken = useRef<string | null>(null)

  // ── Fetch share metadata ────────────────────────────────────────────────────
  const fetchAccessState = useCallback(async (recordAttempt = false) => {
    if (!token) return
    setLoading(true)
    setErrorMsg('')
    try {
      const data = await getShareByToken(token)
      setAccessData(data)
      if (recordAttempt && data?.valid) {
        apiRecordAccessAttempt(token).catch(() => {/* ignore audit-report errors */})
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to contact VaultKey server.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token && initialAccessToken.current !== token) {
      initialAccessToken.current = token
      fetchAccessState(true)
    }
  }, [token, fetchAccessState])

  const isViewOnly = accessData?.access_mode === 'view_only'
  const isWrapped = Boolean(accessData?.wrapped_fek)
  const hasLegacyKey = Boolean(extractLegacyKeyFromFragment(window.location.hash))

  // ── Main action handler ─────────────────────────────────────────────────────
  const handleAccess = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    if (!accessData) return

    setBusy(true)
    try {
      let fekKey: CryptoKey | string | null = null
      let passwordHash: string | undefined = undefined

      if (isWrapped) {
        const cleanPassphrase = password.trim()
        if (!cleanPassphrase) {
          setErrorMsg('Please enter the share passphrase to decrypt.')
          setBusy(false)
          return
        }

        try {
          fekKey = await unwrapShareFEK(accessData, cleanPassphrase)
        } catch {
          throw new Error('Incorrect passphrase. Unable to unwrap encryption key.')
        }

        if (accessData.kdf_salt) {
          passwordHash = await hashSharePassword(cleanPassphrase, accessData.kdf_salt)
        }
      } else {
        // Legacy fallback for old links with #key= fragment
        const legacyKey = extractLegacyKeyFromFragment(window.location.hash)
        if (!legacyKey) {
          setErrorMsg('Missing decryption key or passphrase. Unable to decrypt.')
          setBusy(false)
          return
        }
        fekKey = legacyKey
      }

      if (isViewOnly) {
        const { decryptedBlob, mimeType, fileName } = await viewAndDecrypt(
          token!,
          fekKey,
          password.trim() || undefined,
          passwordHash,
        )
        setViewerBlob(decryptedBlob)
        setViewerFilename(fileName)
        setViewerMime(mimeType)
        setShowViewer(true)
      } else {
        await downloadAndDecrypt(
          token!,
          fekKey,
          password.trim() || undefined,
          passwordHash,
        )
        setDownloadComplete(true)
        fetchAccessState() // refresh remaining counter
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'Unable to authorize access or decrypt file.')
    } finally {
      setBusy(false)
    }
  }

  const handleOpenSecureViewer = async () => {
    if (!accessData?.share_id) {
      setSecureViewerMessage('This share does not provide a Secure Viewer identifier.')
      return
    }

    let keyBase64: string | null = null

    if (isWrapped) {
      const cleanPassphrase = password.trim()
      if (!cleanPassphrase) {
        setErrorMsg('Enter the share passphrase to launch Secure Viewer.')
        return
      }
      try {
        const fekKey = await unwrapShareFEK(accessData, cleanPassphrase)
        keyBase64 = await exportKey(fekKey)
      } catch {
        setErrorMsg('Incorrect passphrase. Unable to unwrap key for Secure Viewer.')
        return
      }
    } else {
      keyBase64 = extractLegacyKeyFromFragment(window.location.hash)
    }

    if (!keyBase64) {
      setSecureViewerMessage('The decryption key or passphrase is required.')
      return
    }

    setLaunchingSecureViewer(true)
    setSecureViewerMessage('Starting VaultKey Secure Viewer…')
    try {
      const nonce = createHandoffNonce()
      const anchor = document.createElement('a')
      anchor.href = createSecureViewerDeepLink(accessData.share_id, nonce)
      anchor.rel = 'noreferrer'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      await transferKeyToSecureViewer(accessData.share_id, nonce, keyBase64)
      setSecureViewerMessage('The encrypted handoff completed. This browser viewer remains separate.')
    } catch (err) {
      setSecureViewerMessage((err as Error).message || 'Secure Viewer handoff failed.')
    } finally {
      setLaunchingSecureViewer(false)
    }
  }

  // ── Viewer close ──────────────────────────────────────────────────────────
  const handleViewerClose = useCallback(() => {
    setShowViewer(false)
    setViewerBlob(null)
    if (token) apiReportBlockedAction(token, 'VIEW_COMPLETED').catch(() => {/* ignore */})
  }, [token])

  // ── Viewer blocked-action callback ────────────────────────────────────────
  const handleBlockedAction = useCallback((event: string) => {
    if (token) apiReportBlockedAction(token, event as 'PRINT_BLOCKED' | 'DOWNLOAD_BLOCKED' | 'SAVE_ATTEMPT_BLOCKED' | 'VIEW_STARTED' | 'VIEW_COMPLETED').catch(() => {/* ignore */})
  }, [token])

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 py-16">
          <div className="w-8 h-8 border border-[rgba(209,208,208,0.2)] border-t-[rgba(209,208,208,0.6)] rounded-full animate-spin" />
          <p className="text-sm text-[rgba(209,208,208,0.4)]">Verifying secure link…</p>
        </div>
      </Shell>
    )
  }

  // ── Error / invalid states ────────────────────────────────────────────────
  if (!accessData || !accessData.valid) {
    const statusCode = accessData?.status ?? 'INVALID'

    const msgs: Record<string, { title: string; message: string }> = {
      REVOKED:       { title: 'Access revoked',          message: 'This VaultKey link has been revoked by its owner.' },
      EXPIRED:       { title: 'Link expired',             message: 'This VaultKey link is no longer available.' },
      LIMIT_REACHED: { title: 'Download limit reached',   message: 'The maximum number of downloads for this file has been reached.' },
      INVALID:       { title: 'Invalid link',             message: 'This VaultKey link is invalid or does not exist.' },
    }
    const cfg = msgs[statusCode] ?? msgs['INVALID']

    return (
      <Shell>
        <div className="border border-[rgba(232,123,123,0.2)] rounded-lg bg-[#0d0d0d] p-8 text-center">
          <AlertCircle size={28} className="text-[#e87b7b] mx-auto mb-4" />
          <h1 className="text-base font-medium text-[#D1D0D0] mb-2">{cfg.title}</h1>
          <p className="text-sm text-[rgba(209,208,208,0.45)]">{cfg.message}</p>
        </div>
      </Shell>
    )
  }

  // ── View-only viewer overlay ──────────────────────────────────────────────
  const viewerOverlay = showViewer && viewerBlob ? (
    <ViewOnlyViewer
      decryptedBlob={viewerBlob}
      filename={viewerFilename}
      mimeType={viewerMime}
      onClose={handleViewerClose}
      onBlockedAction={handleBlockedAction}
    />
  ) : null

  // ── Main card ─────────────────────────────────────────────────────────────
  return (
    <>
      {viewerOverlay}
      <Shell>
        <div className="border border-[rgba(209,208,208,0.1)] rounded-lg bg-[#0d0d0d] overflow-hidden">
          {/* File info */}
          <div className="px-6 py-5 border-b border-[rgba(209,208,208,0.07)]">
            <div className="flex items-center gap-2 mb-3">
              <Lock size={12} className="text-[#6dbf8c]" />
              <span className="text-[10px] tracking-wide text-[rgba(109,191,140,0.7)] font-medium">AES-256-GCM encrypted</span>
              {isViewOnly && (
                <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded border border-amber-500/30 text-amber-400 bg-amber-500/10">
                  View only
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-[#D1D0D0] break-all mb-1">{accessData.original_filename}</p>
            <div className="flex items-center gap-4 text-xs text-[rgba(209,208,208,0.4)]">
              <span>{(accessData.file_size / (1024 * 1024)).toFixed(2)} MB</span>
              {accessData.expires_at && (
                <div className="flex items-center gap-1.5">
                  <Clock size={10} />
                  <span>Expires {new Date(accessData.expires_at).toLocaleDateString()}</span>
                </div>
              )}
              {!isViewOnly && (
                <div className="flex items-center gap-1.5">
                  <Hash size={10} />
                  <span>{accessData.downloads_remaining} downloads left</span>
                </div>
              )}
            </div>
          </div>

          {/* Action area */}
          <div className="px-6 py-5">
            {/* View-only banner */}
            {isViewOnly && (
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded bg-amber-500/5 border border-amber-500/15 mb-4">
                <EyeOff size={13} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-300/80">
                  <strong>Normal Web Viewer</strong> — browser-side restrictions are deterrence only;
                  this browser window does not have OS-level capture protection.
                </p>
              </div>
            )}

            <div className="mb-4 rounded border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="flex items-start gap-2.5">
                <Shield size={14} className="mt-0.5 shrink-0 text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-emerald-200">Windows Secure Viewer</p>
                  <p className="mt-1 text-xs text-emerald-100/60">
                    Uses Windows display-capture protection for supported capture mechanisms.
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenSecureViewer}
                    disabled={launchingSecureViewer || !accessData.share_id}
                    className="mt-3 inline-flex items-center gap-2 rounded border border-emerald-400/30 px-3 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-400/10 disabled:cursor-wait disabled:opacity-50"
                  >
                    <Eye size={13} />
                    {launchingSecureViewer ? 'Connecting…' : 'Open in Secure Viewer'}
                  </button>
                  {secureViewerMessage && (
                    <p role="status" className="mt-2 text-xs text-emerald-100/70">{secureViewerMessage}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Error */}
            {errorMsg && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded bg-rose-500/5 border border-rose-500/15 mb-4">
                <AlertCircle size={13} className="text-rose-400 shrink-0" />
                <p className="text-xs text-rose-300/80">{errorMsg}</p>
              </div>
            )}

            <form onSubmit={handleAccess} className="space-y-4">
              {/* Zero-knowledge notice */}
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded bg-[rgba(209,208,208,0.03)] border border-[rgba(209,208,208,0.07)]">
                <CheckCircle2 size={13} className="text-[#6dbf8c] mt-0.5 shrink-0" />
                <p className="text-xs text-[rgba(209,208,208,0.5)]">
                  {isWrapped
                    ? 'Key unwrapping and file decryption occur locally in your browser using AES-256-GCM. Plaintext keys and passphrases are never transmitted.'
                    : 'This file will be decrypted locally in your browser. The key is never transmitted to VaultKey servers.'}
                </p>
              </div>

              {/* Missing legacy key warning (only if NOT using modern key wrapping) */}
              {!isWrapped && !hasLegacyKey && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 rounded bg-[rgba(232,192,123,0.05)] border border-[rgba(232,192,123,0.15)]">
                  <AlertCircle size={13} className="text-[#e8c07b] mt-0.5 shrink-0" />
                  <p className="text-xs text-[rgba(232,192,123,0.8)]">
                    This legacy link is missing a decryption key fragment in the URL. Ask the sender for the complete link.
                  </p>
                </div>
              )}

              {/* Passphrase / Password field */}
              {(isWrapped || accessData.requires_password) && (
                <div>
                  <label className="block text-xs font-semibold text-[rgba(209,208,208,0.5)] mb-1.5 flex items-center gap-1.5">
                    <Key size={11} className="text-[#6dbf8c]" />
                    <span>{isWrapped ? 'Share Passphrase (Required)' : 'Password required'}</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder={isWrapped ? 'Enter share passphrase to unwrap key…' : 'Enter access password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm bg-[#0a0a0a] border border-[rgba(209,208,208,0.12)] rounded text-[#D1D0D0] focus:outline-none focus:border-[rgba(209,208,208,0.3)] pr-16"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[rgba(209,208,208,0.4)] hover:text-[rgba(209,208,208,0.7)] transition-colors"
                    >
                      {showPassword ? 'hide' : 'show'}
                    </button>
                  </div>
                  {isWrapped && (
                    <p className="text-[11px] text-[rgba(209,208,208,0.35)] mt-1.5">
                      Provided out-of-band by the sender to securely unwrap the encryption key.
                    </p>
                  )}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={busy || ((isWrapped || accessData.requires_password) && !password.trim()) || (!isWrapped && !hasLegacyKey)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded bg-[#D1D0D0] text-black text-sm font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {busy ? (
                  <span className="w-4 h-4 border border-black/30 border-t-black rounded-full animate-spin" />
                ) : isViewOnly ? (
                  <Eye size={14} />
                ) : downloadComplete ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <Download size={14} />
                )}
                {isViewOnly
                  ? 'View document in browser'
                  : downloadComplete
                  ? 'Download again'
                  : 'Decrypt & access file'}
              </button>
            </form>
          </div>
        </div>

        <p className="text-[11px] text-center text-[rgba(209,208,208,0.3)] mt-6">
          VaultKey zero-knowledge key unwrapping and decryption occur exclusively in your browser.
        </p>
      </Shell>
    </>
  )
}
