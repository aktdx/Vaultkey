import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function generateId(length = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, byte => chars[byte % chars.length]).join('')
}

export function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.includes('pdf')) return 'pdf'
  if (mimeType.includes('zip') || mimeType.includes('archive')) return 'archive'
  if (mimeType.includes('text') || mimeType.includes('document')) return 'document'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'spreadsheet'
  return 'file'
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  const ext = str.lastIndexOf('.')
  if (ext > 0) {
    const name = str.slice(0, ext)
    const extension = str.slice(ext)
    const truncLen = max - extension.length - 3
    return name.slice(0, truncLen) + '...' + extension
  }
  return str.slice(0, max - 3) + '...'
}

// ── Zero-knowledge key fragment helpers (Security #1/#2) ──────────────────────
// The encryption key lives ONLY in the URL fragment (#key=...) and is never
// sent to the server. These helpers construct and parse that fragment.

/**
 * Builds the full recipient share URL with the zero-knowledge key fragment.
 * Format: {origin}/s/{token}#key={encryptionKey}
 */
export function buildShareUrl(token: string, encryptionKey: string): string {
  return `${window.location.origin}/s/${token}#key=${encryptionKey}`
}

/**
 * Extracts the encryption key from a URL hash string.
 * @param hash - e.g. "#key=abc123..." or "key=abc123..."
 * @returns The key string, or null if absent.
 */
export function extractKeyFromFragment(hash = window.location.hash): string | null {
  if (!hash) return null
  const clean = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(clean).get('key')
}
