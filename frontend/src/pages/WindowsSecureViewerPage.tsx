import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, LockKeyhole, ShieldCheck } from 'lucide-react'
import { ViewOnlyViewer } from '../components/shares/ViewOnlyViewer'
import { apiCheckAccess, apiCheckSessionStatus, type ApiAccessCheck } from '../lib/api'
import { secureViewAndDecrypt } from '../lib/shares'

interface NativeBridgeMessage {
  type: 'viewer-ready' | 'capture-protection-failed' | 'handoff-key'
  protected?: boolean
  shareId?: string
  keyBase64?: string
}

interface NativeWebView {
  addEventListener: (type: 'message', listener: (event: MessageEvent<NativeBridgeMessage>) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent<NativeBridgeMessage>) => void) => void
  postMessage: (message: unknown) => void
}

const SHARE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function nativeBridge(): NativeWebView | null {
  return (window as Window & { chrome?: { webview?: NativeWebView } }).chrome?.webview ?? null
}

function failureMessage(status: string): string {
  if (status === 'EXPIRED') return 'Access to this document has expired.'
  if (status === 'REVOKED') return 'Access to this document has been revoked.'
  if (status === 'LIMIT_REACHED') return 'The access limit for this document has been reached.'
  return 'VaultKey could not establish a protected viewing environment. The document has not been displayed.'
}

export function WindowsSecureViewerPage() {
  const [shareId, setShareId] = useState('')
  const [protectedWindow, setProtectedWindow] = useState(false)
  const [access, setAccess] = useState<ApiAccessCheck | null>(null)
  const [keyBase64, setKeyBase64] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [decryptedBlob, setDecryptedBlob] = useState<Blob | null>(null)
  const [filename, setFilename] = useState('Protected Document')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bridgeRef = useRef<NativeWebView | null>(null)
  const shareIdRef = useRef('')

  useEffect(() => {
    const bridge = nativeBridge()
    if (!bridge) {
      setError('This route is available only inside the installed Windows Secure Viewer. The document has not been displayed.')
      return
    }
    bridgeRef.current = bridge
    const onMessage = (event: MessageEvent<NativeBridgeMessage>) => {
      const message = event.data
      if (message.type === 'capture-protection-failed') {
        setProtectedWindow(false)
        setDecryptedBlob(null)
        setKeyBase64(null)
        setError('Secure display protection could not be enabled. The document will not be displayed.')
      } else if (message.type === 'viewer-ready') {
        if (!message.protected || !message.shareId || !SHARE_ID_PATTERN.test(message.shareId)) {
          setError('VaultKey could not establish a protected viewing environment. The document has not been displayed.')
          return
        }
        shareIdRef.current = message.shareId
        setShareId(message.shareId)
        setProtectedWindow(true)
      } else if (message.type === 'handoff-key' && message.shareId === shareIdRef.current && message.keyBase64) {
        setKeyBase64(message.keyBase64)
      }
    }
    bridge.addEventListener('message', onMessage)
    bridge.postMessage({ type: 'viewer-ready' })
    return () => {
      bridge.removeEventListener('message', onMessage)
      bridgeRef.current = null
    }
  }, [shareId])

  useEffect(() => {
    if (!protectedWindow || !shareId) return
    let cancelled = false
    apiCheckAccess(shareId).then(result => {
      if (cancelled) return
      if (!result.valid) {
        setError(failureMessage(result.status))
        return
      }
      setAccess(result)
      setFilename(result.original_filename)
    }).catch(() => {
      if (!cancelled) setError('Share validation failed. The document has not been displayed.')
    })
    return () => { cancelled = true }
  }, [protectedWindow, shareId])

  useEffect(() => {
    if (!decryptedBlob || !shareId) return
    const timer = window.setInterval(() => {
      apiCheckSessionStatus(shareId).then(result => {
        if (!result.valid) {
          setDecryptedBlob(null)
          setKeyBase64(null)
          setError(failureMessage(result.status))
        }
      }).catch(() => {
        setDecryptedBlob(null)
        setKeyBase64(null)
        setError('Share status could not be verified. The document has been hidden.')
      })
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [decryptedBlob, shareId])

  const handleDecrypt = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!protectedWindow || !access?.valid || !keyBase64 || (access.requires_password && !password)) return
    setBusy(true)
    setError('')
    let opened = false
    try {
      const result = await secureViewAndDecrypt(shareId, keyBase64, password || undefined)
      setFilename(result.fileName)
      setDecryptedBlob(result.decryptedBlob)
      opened = true
    } catch (cause) {
      setError((cause as Error).message || 'Document integrity or decryption validation failed.')
      setKeyBase64(null)
    } finally {
      setBusy(false)
      if (opened) setKeyBase64(null)
    }
  }

  if (decryptedBlob) {
    return (
      <ViewOnlyViewer
        decryptedBlob={decryptedBlob}
        filename={filename}
        mimeType={decryptedBlob.type}
        onClose={() => setDecryptedBlob(null)}
        onBlockedAction={() => undefined}
        secureWindows
        shareId={shareId}
        expiresAt={access?.expires_at ?? null}
      />
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#101512] px-5 py-10 text-[#e7eee8]">
      <section className="w-full max-w-lg border border-white/10 bg-[#171f1a] p-7 shadow-2xl">
        <div className="mb-7 flex items-center gap-3">
          <ShieldCheck className={protectedWindow ? 'text-emerald-400' : 'text-amber-400'} size={22} />
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-white/60">VAULTKEY SECURE VIEWER</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-300">
              <LockKeyhole size={12} /> {protectedWindow ? 'Protected window active' : 'Verifying native protection'}
            </p>
          </div>
        </div>

        {error ? (
          <div role="alert" className="flex gap-3 border border-rose-300/20 bg-rose-300/5 p-4 text-sm text-rose-100">
            <AlertTriangle className="mt-0.5 shrink-0 text-rose-300" size={17} />
            <p>{error}</p>
          </div>
        ) : !access ? (
          <p className="py-8 text-sm text-white/60">Validating share…</p>
        ) : (
          <>
            <div className="border-y border-white/10 py-4">
              <p className="text-[10px] font-semibold tracking-widest text-white/40">PROTECTED DOCUMENT</p>
              <p className="mt-2 break-words text-base font-medium">{filename}</p>
              <p className="mt-2 text-xs text-white/50">Windows Secure Viewer uses Windows display-capture protection for supported capture mechanisms.</p>
              <p className="mt-2 text-xs text-white/50">
                Session expires: {access.expires_at ? new Date(access.expires_at).toLocaleString() : 'No scheduled expiration'}
              </p>
            </div>
            <form className="mt-5 space-y-4" onSubmit={handleDecrypt}>
              {access.requires_password && (
                <label className="block text-xs text-white/60">
                  Share password
                  <input
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    className="mt-2 w-full border border-white/15 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-300/60"
                  />
                </label>
              )}
              <p className="text-xs text-white/50">
                {keyBase64 ? 'Encrypted key handoff received.' : 'Waiting for the key-free desktop handoff from the share page.'}
              </p>
              <button
                type="submit"
                disabled={!keyBase64 || busy || (access.requires_password && !password)}
                className="w-full border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm font-medium text-emerald-100 hover:bg-emerald-300/15 disabled:cursor-wait disabled:opacity-40"
              >
                {busy ? 'Decrypting locally…' : 'Open protected document'}
              </button>
            </form>
            {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}
          </>
        )}
      </section>
    </main>
  )
}