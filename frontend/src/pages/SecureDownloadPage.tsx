/**
 * SecureDownloadPage — recipient-facing share access page.
 *
 * Security #2 implementation:
 *   • Calls /view for VIEW_ONLY shares — never /download (server enforces this too).
 *   • Passes decrypted Blob to ViewOnlyViewer which has full browser-side deterrence.
 *   • Reports blocked actions (Ctrl+S, Ctrl+P, right-click) to the backend audit log.
 *   • Decryption key lives only in window.location.hash — never sent to server.
 *   • download flow: AES-256-GCM decrypt in browser → temporary anchor click → revoke URL.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  Shield, FileText, Lock, Clock, Hash,
  Download, CheckCircle2, AlertCircle, Eye, EyeOff,
} from 'lucide-react'
import { getShareByToken, authorizePassword, downloadAndDecrypt, viewAndDecrypt } from '../lib/shares'
import { apiReportBlockedAction } from '../lib/api'
import { extractKeyFromFragment } from '../lib/utils'
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

  // ── Fetch share metadata ────────────────────────────────────────────────────
  const fetchAccessState = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setErrorMsg('')
    try {
      const data = await getShareByToken(token)
      setAccessData(data)
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to contact VaultKey server.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) fetchAccessState()
  }, [token, fetchAccessState])

  const isViewOnly = accessData?.access_mode === 'view_only'

  // ── Main action handler ─────────────────────────────────────────────────────
  const handleAccess = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    // Key lives only in the URL fragment — never sent to the server.
    const keyBase64 = extractKeyFromFragment(window.location.hash)
    if (!keyBase64) {
      setErrorMsg('Missing decryption key fragment in URL. Unable to decrypt.')
      return
    }

    setBusy(true)
    try {
      if (isViewOnly) {
        // VIEW_ONLY: use /view endpoint — logs VIEW_STARTED, never increments counter
        const { decryptedBlob, mimeType, fileName } = await viewAndDecrypt(
          token!,
          keyBase64,
          password || undefined,
        )
        setViewerBlob(decryptedBlob)
        setViewerFilename(fileName)
        setViewerMime(mimeType)
        setShowViewer(true)
      } else {
        // DOWNLOAD: use /download endpoint, triggers browser save
        await downloadAndDecrypt(token!, keyBase64, password || undefined)
        setDownloadComplete(true)
        fetchAccessState() // refresh remaining counter
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'Unable to authorize access or decrypt file.')
    } finally {
      setBusy(false)
    }
  }

  // ── Viewer close ──────────────────────────────────────────────────────────
  const handleViewerClose = useCallback(() => {
    setShowViewer(false)
    setViewerBlob(null)
    // Report VIEW_COMPLETED to the backend audit log (fire-and-forget)
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
                  <strong>View-Only Mode</strong> — You can read this document in your browser.
                  Downloading and printing are disabled for this share.
                </p>
              </div>
            )}

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
                  {isViewOnly
                    ? 'This file will be decrypted locally. The key is never transmitted to VaultKey servers.'
                    : 'This file will be decrypted locally in your browser. The key is never transmitted to VaultKey servers.'}
                </p>
              </div>

              {/* Missing key warning */}
              {!extractKeyFromFragment(window.location.hash) && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 rounded bg-[rgba(232,192,123,0.05)] border border-[rgba(232,192,123,0.15)]">
                  <AlertCircle size={13} className="text-[#e8c07b] mt-0.5 shrink-0" />
                  <p className="text-xs text-[rgba(232,192,123,0.8)]">
                    No decryption key in URL. The link may be incomplete — ask the sender to resend the full link.
                  </p>
                </div>
              )}

              {/* Password field */}
              {accessData.requires_password && (
                <div>
                  <label className="block text-xs font-semibold text-[rgba(209,208,208,0.5)] mb-1.5 flex items-center gap-1.5">
                    <Lock size={11} />
                    <span>Password required</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="Enter access password"
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
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={busy || !extractKeyFromFragment(window.location.hash)}
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
          VaultKey client-side decryption occurs in your browser.
        </p>
      </Shell>
    </>
  )
}
