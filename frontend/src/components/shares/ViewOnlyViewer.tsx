/**
 * ViewOnlyViewer
 *
 * Renders decrypted file content inside a controlled in-browser viewer.
 *
 * Security posture
 * ────────────────
 * This component implements browser-side DETERRENCE against casual saving,
 * downloading, and printing.  It is NOT a DRM system.  A determined recipient
 * who controls their device can still extract content that their browser has
 * legitimately received and decrypted.  The server-side access_mode check
 * in /api/access/{token}/download is the actual security boundary.
 *
 * Deterrents implemented here:
 *   • Right-click context-menu suppressed on the viewer container.
 *   • Common save/print/devtools keyboard shortcuts intercepted
 *     (Ctrl/Cmd+S, Ctrl/Cmd+P, Ctrl/Cmd+Shift+S, Ctrl/Cmd+U,
 *      Ctrl/Cmd+Shift+I, Ctrl/Cmd+Shift+J, Ctrl/Cmd+Shift+C, F12).
 *   • window.print() replaced with a no-op for the lifetime of the viewer.
 *   • @media print CSS hides the page body.
 *   • Blob URL is revoked on unmount — decrypted data is not held in memory
 *     beyond the viewer's lifetime.
 *   • No localStorage/sessionStorage/IndexedDB caching of decrypted content.
 *   • Visual "VIEW ONLY" banner and subtle watermark.
 *
 * What this does NOT prevent:
 *   • Browser network inspector (content was already received).
 *   • Memory inspection or modified browser.
 *   • Screenshots or screen recording.
 *   • Physical cameras aimed at the screen.
 */

import React, { useEffect, useRef, useCallback, useState } from 'react'
import { X, EyeOff, ShieldAlert } from 'lucide-react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'

// Configure PDF.js worker once at module level.
// Must use the URL form so the worker runs in a separate thread.
// pdfjs-dist v3 is CJS; named imports work correctly with Vite's CJS interop.
GlobalWorkerOptions.workerSrc = workerUrl

// ─── Print-block style injected once globally ────────────────────────────────
const PRINT_BLOCK_STYLE_ID = 'vk-view-only-print-block'

function injectPrintBlockStyle(): void {
  if (document.getElementById(PRINT_BLOCK_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = PRINT_BLOCK_STYLE_ID
  style.textContent = `@media print { body { display: none !important; } }`
  document.head.appendChild(style)
}

function removePrintBlockStyle(): void {
  document.getElementById(PRINT_BLOCK_STYLE_ID)?.remove()
}

// ─── Keyboard shortcut deterrence ────────────────────────────────────────────

/**
 * Returns true if the event matches a shortcut to block in view-only mode.
 * Input fields are excluded so normal typing is not affected.
 */
function isBlockedShortcut(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey
  const shift = e.shiftKey
  const key = e.key?.toLowerCase()

  const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false

  if (mod && key === 's') return true
  if (mod && key === 'p') return true
  if (mod && key === 'u') return true
  if (key === 'f12') return true
  if (mod && shift && key === 'i') return true
  if (mod && shift && key === 'j') return true
  if (mod && shift && key === 'c') return true

  return false
}

function blockedShortcutEvent(e: KeyboardEvent): string {
  const mod = e.ctrlKey || e.metaKey
  const key = e.key?.toLowerCase()
  if (mod && key === 'p') return 'PRINT_BLOCKED'
  if (mod && key === 's') return 'SAVE_ATTEMPT_BLOCKED'
  return 'DOWNLOAD_BLOCKED'
}

// ─── MIME type helpers ────────────────────────────────────────────────────────

function isImageMime(mime: string | undefined): boolean {
  return !!mime?.startsWith('image/')
}

function isTextMime(mime: string | undefined): boolean {
  if (!mime) return false
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/javascript' ||
    mime === 'application/x-python' ||
    mime === 'application/xml'
  )
}

function isPdfMime(mime: string | undefined): boolean {
  return mime === 'application/pdf'
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ViewOnlyViewerProps {
  decryptedBlob: Blob
  filename: string
  mimeType: string
  onClose: () => void
  onBlockedAction: (event: string) => void
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ViewOnlyViewer({
  decryptedBlob,
  filename,
  mimeType,
  onClose,
  onBlockedAction,
}: ViewOnlyViewerProps) {
  const blobUrlRef = useRef<string | null>(null)
  const originalPrintRef = useRef<typeof window.print | null>(null)

  // Create blob URL once
  if (!blobUrlRef.current && decryptedBlob) {
    blobUrlRef.current = URL.createObjectURL(decryptedBlob)
  }

  // Keyboard deterrence
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isBlockedShortcut(e)) return
      e.preventDefault()
      e.stopPropagation()
      onBlockedAction(blockedShortcutEvent(e))
    },
    [onBlockedAction],
  )

  // Context-menu deterrence
  const handleContextMenu = useCallback((e: Event) => {
    e.preventDefault()
  }, [])

  // Patch + restore window.print
  useEffect(() => {
    originalPrintRef.current = window.print
    window.print = () => { onBlockedAction('PRINT_BLOCKED') }
    return () => {
      if (originalPrintRef.current) window.print = originalPrintRef.current
    }
  }, [onBlockedAction])

  // Print-block CSS + event listeners
  useEffect(() => {
    injectPrintBlockStyle()
    document.addEventListener('keydown', handleKeyDown, { capture: true })
    document.addEventListener('contextmenu', handleContextMenu, { capture: true })
    return () => {
      removePrintBlockStyle()
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
      document.removeEventListener('contextmenu', handleContextMenu, { capture: true })
    }
  }, [handleKeyDown, handleContextMenu])

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [])

  const handleClose = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    onClose()
  }

  const renderContent = () => {
    const blobUrl = blobUrlRef.current
    if (!blobUrl) return null

    if (isPdfMime(mimeType)) {
      return <PdfViewer decryptedBlob={decryptedBlob} filename={filename} />
    }

    if (isImageMime(mimeType)) {
      return (
        <div className="flex items-center justify-center w-full h-full overflow-auto p-4 bg-gray-900">
          <img
            src={blobUrl}
            alt={filename}
            className="max-w-full max-h-full object-contain rounded"
            style={{ userSelect: 'none', pointerEvents: 'none' }}
            draggable={false}
          />
        </div>
      )
    }

    if (isTextMime(mimeType)) {
      return <TextViewer blobUrl={blobUrl} mimeType={mimeType} />
    }

    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-4 text-gray-400">
        <ShieldAlert className="w-12 h-12 text-amber-400" />
        <p className="text-sm font-medium text-white">Inline preview not available for this file type.</p>
        <p className="text-xs text-gray-500">({mimeType || 'unknown type'})</p>
        <p className="text-xs text-gray-600 max-w-xs text-center">
          This share is View-Only. Downloading is not permitted.
        </p>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      onContextMenu={e => e.preventDefault()}
      onDragStart={e => e.preventDefault()}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between bg-[#0D1526] border-b border-[#1E2D47] px-5 py-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-amber-500/15 text-amber-400 rounded-lg shrink-0">
            <EyeOff className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{filename}</p>
            <p className="text-xs text-amber-400 font-medium">
              VIEW ONLY — Downloading and printing are disabled for this share.
            </p>
          </div>
        </div>

        <span
          className="hidden sm:block text-[10px] font-mono text-gray-600 select-none mx-4 shrink-0"
          aria-hidden="true"
        >
          VaultKey • View Only
        </span>

        <button
          onClick={handleClose}
          aria-label="Close viewer"
          className="p-2 bg-[#1A2438] hover:bg-[#253044] rounded-xl text-gray-400 hover:text-white transition-colors shrink-0 ml-2"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto relative">
        <div
          className="absolute inset-0 pointer-events-none z-10 flex items-end justify-end p-4"
          aria-hidden="true"
        >
          <span className="text-[10px] font-mono text-white/5 select-none">
            VaultKey • View Only
          </span>
        </div>
        {renderContent()}
      </div>

      {/* Footer disclaimer */}
      <div className="shrink-0 bg-[#0D1526] border-t border-[#1E2D47] px-5 py-2 text-center">
        <p className="text-[10px] text-gray-600">
          View-Only mode provides browser-side deterrence against casual downloading, saving, and
          printing. Content rendered on a recipient-controlled device cannot be made completely
          non-extractable.
        </p>
      </div>
    </div>
  )
}

// ─── Text viewer ──────────────────────────────────────────────────────────────

function TextViewer({ blobUrl, mimeType }: { blobUrl: string; mimeType: string }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(blobUrl)
      .then(r => r.text())
      .then(t => { if (!cancelled) { setText(t); setLoading(false) } })
      .catch(() => { if (!cancelled) { setText('Unable to render content.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [blobUrl])

  const isJson = mimeType === 'application/json'
  let displayText = text
  if (isJson && text) {
    try { displayText = JSON.stringify(JSON.parse(text), null, 2) } catch { /* leave as-is */ }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-400" />
      </div>
    )
  }

  return (
    <div className="w-full h-full overflow-auto p-4 bg-[#0B1120]">
      <pre className="text-xs text-gray-200 font-mono whitespace-pre-wrap break-words select-text leading-relaxed">
        {displayText}
      </pre>
    </div>
  )
}

// ─── PDF viewer ───────────────────────────────────────────────────────────────

/**
 * Renders a PDF blob using PDF.js onto a series of <canvas> elements.
 *
 * Accepts the raw decrypted blob directly — no blob URL is created or passed —
 * eliminating the iframe URL-loading pattern that caused blank rendering in
 * modern browsers due to CSP / sandbox restrictions.
 *
 * This is the Security #2 fix: replaces the broken <iframe src={blobUrl}> approach.
 */
function PdfViewer({ decryptedBlob, filename }: { decryptedBlob: Blob; filename: string }) {
  const [pageCanvases, setPageCanvases] = useState<HTMLCanvasElement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!decryptedBlob) return

    let cancelled = false
    // ponytail: typed as any[] — PDF.js renderTask type is not exported publicly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeTasks: any[] = []

    async function renderPdf() {
      try {
        const arrayBuffer = await decryptedBlob.arrayBuffer()
        if (cancelled) return

        const loadingTask = getDocument({ data: arrayBuffer })
        const pdfDoc = await loadingTask.promise
        if (cancelled) return

        const numPages = pdfDoc.numPages
        const canvasElements: HTMLCanvasElement[] = []

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          if (cancelled) break
          const page = await pdfDoc.getPage(pageNum)
          if (cancelled) break

          const desiredWidth = containerRef.current
            ? containerRef.current.clientWidth - 32
            : 800
          const unscaledViewport = page.getViewport({ scale: 1 })
          const scale = desiredWidth / unscaledViewport.width
          const viewport = page.getViewport({ scale })

          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.display = 'block'
          canvas.style.width = '100%'
          canvas.setAttribute('aria-label', `Page ${pageNum} of ${numPages}`)

          const canvasContext = canvas.getContext('2d')!
          const renderTask = page.render({ canvasContext, viewport })
          activeTasks.push(renderTask)

          await renderTask.promise
          if (cancelled) break

          canvasElements.push(canvas)
        }

        if (!cancelled) {
          setPageCanvases(canvasElements)
          setLoading(false)
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const name = (err as { name?: string })?.name
          if (name !== 'RenderingCancelledException') {
            setError('This PDF could not be displayed in your browser.')
          }
          setLoading(false)
        }
      }
    }

    renderPdf()

    return () => {
      cancelled = true
      for (const task of activeTasks) {
        try { task.cancel() } catch { /* ignore */ }
      }
    }
  }, [decryptedBlob])

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-4 text-gray-400 px-4">
        <ShieldAlert className="w-10 h-10 text-red-400" />
        <p className="text-sm font-medium text-white text-center">{error}</p>
        <p className="text-xs text-gray-500 text-center max-w-xs">
          Try a different browser, or contact the sender if the problem persists.
        </p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-auto p-4 bg-gray-900 flex flex-col items-center gap-4"
    >
      {pageCanvases.map((canvas, idx) => (
        <CanvasPage key={idx} canvas={canvas} />
      ))}
    </div>
  )
}

// ─── Canvas page mount ────────────────────────────────────────────────────────

/**
 * Mounts a pre-rendered <canvas> DOM node into the React tree.
 * Ref attachment avoids cloning (which would lose pixel data).
 */
function CanvasPage({ canvas }: { canvas: HTMLCanvasElement }) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (wrapper && canvas) {
      wrapper.appendChild(canvas)
      return () => {
        if (canvas.parentNode === wrapper) wrapper.removeChild(canvas)
      }
    }
  }, [canvas])

  return <div ref={wrapperRef} className="w-full rounded shadow-lg" style={{ maxWidth: '100%' }} />
}
