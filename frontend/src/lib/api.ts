/**
 * VaultKey — FastAPI Backend API Client
 * Replaces Supabase calls with direct FastAPI + Neon + Cloudflare R2 calls.
 *
 * Base URL driven by VITE_API_URL env variable.
 * Auth: Bearer JWT stored in localStorage.
 */

const BASE_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:8000'

// ── Token storage ──────────────────────────────────────────────────────────────
const TOKEN_KEY = 'vaultkey_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

// ── Base fetch wrapper ─────────────────────────────────────────────────────────
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  authenticated = true
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> ?? {}),
  }

  if (authenticated) {
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const json = await res.json()
      detail = json.detail ?? JSON.stringify(json)
    } catch {/* ignore */}
    throw new Error(detail)
  }

  // Some endpoints return non-JSON (blobs)
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>
  }
  return res as unknown as T
}

// ── Types matching backend schemas ─────────────────────────────────────────────

export interface ApiUser {
  id: string
  email: string
  created_at: string
}

export interface ApiTokenResponse {
  access_token: string
  token_type: string
  user: ApiUser
}

export interface ApiFile {
  id: string
  original_filename: string
  size: number
  mime_type: string
  iv_hex: string
  created_at: string
  active_shares_count: number
  total_downloads: number
}

export interface ApiShareCreateResponse {
  share_id: string
  token: string
  file_id: string
  original_filename: string
  expires_at: string | null
  max_downloads: number
  access_mode: 'download' | 'view_only'
  has_password: boolean
  created_at: string
}

export interface ApiShareDetail {
  id: string
  file_id: string
  original_filename: string
  expires_at: string | null
  max_downloads: number
  download_count: number
  access_mode: 'download' | 'view_only'
  has_password: boolean
  revoked: boolean
  revoked_at: string | null
  created_at: string
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'LIMIT_REACHED' | 'VIEW_ONLY'
}

export interface ApiAccessCheck {
  valid: boolean
  original_filename: string
  file_size: number
  expires_at: string | null
  max_downloads: number
  downloads_remaining: number
  access_mode: 'download' | 'view_only'
  requires_password: boolean
  revoked: boolean
  status: 'OK' | 'EXPIRED' | 'REVOKED' | 'LIMIT_REACHED' | 'INVALID'
}

export interface ApiActivityLog {
  id: string
  file_id: string | null
  filename: string | null
  event: string
  status: string
  user_agent: string | null
  ip_address: string | null
  timestamp: string
}


// ── Auth ───────────────────────────────────────────────────────────────────────

export async function apiRegister(email: string, password: string): Promise<ApiTokenResponse> {
  return apiFetch<ApiTokenResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, false)
}

export async function apiLogin(email: string, password: string): Promise<ApiTokenResponse> {
  return apiFetch<ApiTokenResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, false)
}

export async function apiGetMe(): Promise<ApiUser> {
  return apiFetch<ApiUser>('/api/auth/me')
}


// ── Files ──────────────────────────────────────────────────────────────────────

export async function apiListFiles(): Promise<ApiFile[]> {
  return apiFetch<ApiFile[]>('/api/files')
}

export async function apiGetFile(fileId: string): Promise<ApiFile> {
  return apiFetch<ApiFile>(`/api/files/${fileId}`)
}

export async function apiUploadEncryptedFile(
  encryptedBlob: Blob,
  originalFilename: string,
  ivHex: string,
  onProgress?: (pct: number) => void
): Promise<ApiFile> {
  const formData = new FormData()
  formData.append('file', encryptedBlob, `${originalFilename}.enc`)
  formData.append('original_filename', originalFilename)
  formData.append('iv_hex', ivHex)

  // Use XMLHttpRequest for upload progress
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE_URL}/api/files`)

    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress?.(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as ApiFile)
        } catch {
          reject(new Error('Invalid response'))
        }
      } else {
        try {
          const body = JSON.parse(xhr.responseText)
          reject(new Error(body.detail ?? `HTTP ${xhr.status}`))
        } catch {
          reject(new Error(`HTTP ${xhr.status}`))
        }
      }
    }

    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(formData)
  })
}

export async function apiDeleteFile(fileId: string): Promise<void> {
  await apiFetch<void>(`/api/files/${fileId}`, { method: 'DELETE' })
}


// ── Shares ─────────────────────────────────────────────────────────────────────

export interface CreateSharePayload {
  file_id: string
  expiration_hours?: number | null
  max_downloads?: number
  access_mode?: 'download' | 'view_only'
  password?: string | null
}

export async function apiCreateShare(payload: CreateSharePayload): Promise<ApiShareCreateResponse> {
  return apiFetch<ApiShareCreateResponse>('/api/shares', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function apiListShares(fileId?: string): Promise<ApiShareDetail[]> {
  const qs = fileId ? `?file_id=${fileId}` : ''
  return apiFetch<ApiShareDetail[]>(`/api/shares${qs}`)
}

export async function apiGetShare(shareId: string): Promise<ApiShareDetail> {
  return apiFetch<ApiShareDetail>(`/api/shares/${shareId}`)
}

export async function apiRevokeShare(shareId: string): Promise<void> {
  await apiFetch<void>(`/api/shares/${shareId}/revoke`, { method: 'POST' })
}


// ── Recipient Access (public — no auth token needed) ──────────────────────────

export async function apiCheckAccess(token: string): Promise<ApiAccessCheck> {
  return apiFetch<ApiAccessCheck>(`/api/access/${token}`, {}, false)
}

export async function apiAuthorizePassword(
  token: string,
  password: string
): Promise<void> {
  await apiFetch<void>(`/api/access/${token}/authorize`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  }, false)
}

/**
 * Download the encrypted blob for a DOWNLOAD-mode share.
 * Returns { blob, ivHex, originalFilename, mimeType }.
 */
export async function apiDownloadFile(
  token: string,
  password?: string
): Promise<{ blob: Blob; ivHex: string; originalFilename: string; mimeType: string }> {
  const token_jwt = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token_jwt) headers['Authorization'] = `Bearer ${token_jwt}`

  const res = await fetch(`${BASE_URL}/api/access/${token}/download`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ password: password ?? null }),
  })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { const j = await res.json(); detail = j.detail ?? detail } catch {/* */}
    throw new Error(detail)
  }

  const blob = await res.blob()
  const ivHex = res.headers.get('X-IV-Hex') ?? ''
  const originalFilename = res.headers.get('X-Original-Filename') ?? 'download'
  const mimeType = res.headers.get('X-Mime-Type') ?? 'application/octet-stream'

  return { blob, ivHex, originalFilename, mimeType }
}

/**
 * Fetch the encrypted blob for a VIEW_ONLY share (no download increment).
 */
export async function apiViewFile(
  token: string,
  password?: string
): Promise<{ blob: Blob; ivHex: string; originalFilename: string; mimeType: string }> {
  const res = await fetch(`${BASE_URL}/api/access/${token}/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: password ?? null }),
  })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { const j = await res.json(); detail = j.detail ?? detail } catch {/* */}
    throw new Error(detail)
  }

  const blob = await res.blob()
  const ivHex = res.headers.get('X-IV-Hex') ?? ''
  const originalFilename = res.headers.get('X-Original-Filename') ?? 'document'
  const mimeType = res.headers.get('X-Mime-Type') ?? 'application/octet-stream'

  return { blob, ivHex, originalFilename, mimeType }
}

export async function apiReportBlockedAction(
  token: string,
  event: 'PRINT_BLOCKED' | 'DOWNLOAD_BLOCKED' | 'SAVE_ATTEMPT_BLOCKED' | 'VIEW_STARTED' | 'VIEW_COMPLETED'
): Promise<void> {
  await fetch(`${BASE_URL}/api/access/${token}/report-blocked`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  }).catch(() => {/* fire-and-forget */})
}


// ── Activity ───────────────────────────────────────────────────────────────────

export async function apiListActivity(limit = 100): Promise<ApiActivityLog[]> {
  return apiFetch<ApiActivityLog[]>(`/api/activity?limit=${limit}`)
}


// ── Health ─────────────────────────────────────────────────────────────────────

export async function apiHealth(): Promise<{ status: string }> {
  return apiFetch<{ status: string }>('/api/health', {}, false)
}
