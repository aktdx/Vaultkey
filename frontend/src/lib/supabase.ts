/**
 * supabase.ts — LEGACY TYPE ALIASES ONLY
 *
 * VaultKey has migrated from Supabase to a FastAPI + Neon PostgreSQL + Cloudflare R2 backend.
 * The Supabase client is no longer used. This file is retained only for any leftover
 * type references. New code should import types directly from `./api` instead.
 *
 * These types are intentionally kept as aliases/stubs so existing import paths
 * continue to compile without error during the migration period.
 */

import type { ApiFile, ApiShareDetail, ApiActivityLog } from './api'

// ── Legacy type aliases ────────────────────────────────────────────────────────

/** @deprecated Use ApiFile from ./api */
export type FileRecord = ApiFile & {
  // Shim fields that old code may reference — map to ApiFile equivalents
  name: string            // → original_filename
  storage_path: string    // → id (R2 key is managed by backend)
  encrypted: boolean      // always true on the new backend
  share_count: number     // → active_shares_count
  download_count: number  // → total_downloads
  user_id: string         // not returned by backend
}

/** @deprecated Use ApiShareDetail from ./api */
export type ShareRecord = ApiShareDetail & {
  // Shim fields
  file_id: string
  user_id: string
  token: string
  token_hash: string
  password_hash: string | null
  password_salt: string | null
  is_revoked: boolean     // → revoked
  label: string | null
}

/** @deprecated Use ApiActivityLog from ./api */
export type ActivityLogRecord = ApiActivityLog & {
  share_id: string | null
  event_type: string      // → event
  metadata: Record<string, unknown> | null
}

export type ActivityEventType =
  | 'file_uploaded'
  | 'share_created'
  | 'share_accessed'
  | 'password_verified'
  | 'password_failed'
  | 'file_downloaded'
  | 'share_revoked'
  | 'share_expired'
  | 'download_limit_reached'
  | 'share_deleted'
  | 'file_deleted'

export type Database = {
  public: {
    Tables: {
      files:          { Row: FileRecord;          Insert: Partial<FileRecord>; Update: Partial<FileRecord> }
      shares:         { Row: ShareRecord;         Insert: Partial<ShareRecord>; Update: Partial<ShareRecord> }
      activity_logs:  { Row: ActivityLogRecord;   Insert: Partial<ActivityLogRecord>; Update: never }
    }
  }
}
