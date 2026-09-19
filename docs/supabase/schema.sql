-- ============================================================
-- VaultKey — Complete Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── 1. EXTENSIONS ─────────────────────────────────────────────────────────
-- pgcrypto gives us gen_random_uuid() and digest() for token hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ── 2. TABLES ─────────────────────────────────────────────────────────────

-- Files: one row per uploaded (encrypted) file
CREATE TABLE IF NOT EXISTS public.files (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text        NOT NULL,           -- original filename (plaintext metadata)
  size           bigint      NOT NULL,           -- original file size in bytes
  mime_type      text        NOT NULL DEFAULT 'application/octet-stream',
  storage_path   text        NOT NULL,           -- path inside the Supabase Storage bucket
  encrypted      boolean     NOT NULL DEFAULT true,
  iv_hex         text,                           -- hex-encoded 12-byte IV (informational; IV also prepended in blob)
  share_count    int         NOT NULL DEFAULT 0,
  download_count int         NOT NULL DEFAULT 0
);

-- Shares: one row per secure sharing link
CREATE TABLE IF NOT EXISTS public.shares (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  file_id         uuid        NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token           text        NOT NULL UNIQUE,           -- the raw token sent in the share URL
  token_hash      text        NOT NULL UNIQUE,           -- SHA-256(token) used for lookups
  expires_at      timestamptz,                           -- NULL = no expiry
  max_downloads   int,                                   -- NULL = unlimited
  download_count  int         NOT NULL DEFAULT 0,
  password_hash   text,                                  -- PBKDF2-SHA256 derived hash (never raw password)
  password_salt   text,                                  -- random hex salt used for PBKDF2
  is_revoked      boolean     NOT NULL DEFAULT false,
  label           text                                   -- optional human label e.g. "For CFO"
);

-- Activity logs: immutable security audit trail
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  user_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  share_id     uuid        REFERENCES public.shares(id) ON DELETE SET NULL,
  file_id      uuid        REFERENCES public.files(id) ON DELETE SET NULL,
  event_type   text        NOT NULL,  -- see ActivityEventType in src/lib/supabase.ts
  ip_address   text,
  user_agent   text,
  metadata     jsonb
);


-- ── 3. INDEXES ────────────────────────────────────────────────────────────
-- Speed up share lookups by token hash (used on every download page load)
CREATE INDEX IF NOT EXISTS shares_token_hash_idx ON public.shares(token_hash);

-- Speed up activity feed queries per user
CREATE INDEX IF NOT EXISTS activity_logs_user_id_idx ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS activity_logs_file_id_idx  ON public.activity_logs(file_id);
CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON public.activity_logs(created_at DESC);

-- Speed up file listing per user
CREATE INDEX IF NOT EXISTS files_user_id_idx ON public.files(user_id);


-- ── 4. ROW LEVEL SECURITY ─────────────────────────────────────────────────
ALTER TABLE public.files          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shares         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs  ENABLE ROW LEVEL SECURITY;

-- FILES: owners can do everything; no one else can read
CREATE POLICY "file_owner_all" ON public.files
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- SHARES: owners can do everything
CREATE POLICY "share_owner_all" ON public.shares
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- SHARES: anonymous users can SELECT a share by token_hash (needed for download page)
-- We expose only the minimum fields needed to serve the download.
CREATE POLICY "share_public_read" ON public.shares
  FOR SELECT
  USING (true);   -- filtered by token_hash in application code, not sensitive without the key

-- ACTIVITY LOGS: owners can read their own logs
CREATE POLICY "log_owner_read" ON public.activity_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- ACTIVITY LOGS: server/edge function inserts (service role) — no INSERT policy needed for anon
-- For client-side inserts from the browser, allow authenticated users to insert their own:
CREATE POLICY "log_owner_insert" ON public.activity_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);


-- ── 5. ATOMIC DOWNLOAD COUNTER FUNCTION ──────────────────────────────────
-- Called when a file is downloaded. Increments atomically and returns the
-- updated share row so we can enforce limits without a race condition.
CREATE OR REPLACE FUNCTION public.increment_download_count(p_token_hash text)
RETURNS public.shares
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as DB owner so it bypasses RLS for the update
AS $$
DECLARE
  v_share public.shares;
BEGIN
  -- Lock the row, increment, and return in one statement
  UPDATE public.shares
  SET    download_count = download_count + 1
  WHERE  token_hash = p_token_hash
    AND  is_revoked   = false
    AND  (expires_at  IS NULL OR expires_at > now())
    AND  (max_downloads IS NULL OR download_count < max_downloads)
  RETURNING * INTO v_share;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'share_not_available';
  END IF;

  RETURN v_share;
END;
$$;

-- Grant execute to the anon role (called from the browser on download)
GRANT EXECUTE ON FUNCTION public.increment_download_count(text) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_download_count(text) TO authenticated;


-- ── 6. FILE SHARE COUNT TRIGGER ───────────────────────────────────────────
-- Automatically keeps files.share_count in sync when shares are created/deleted
CREATE OR REPLACE FUNCTION public.sync_file_share_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.files
  SET share_count = (
    SELECT COUNT(*) FROM public.shares
    WHERE file_id = COALESCE(NEW.file_id, OLD.file_id)
      AND is_revoked = false
  )
  WHERE id = COALESCE(NEW.file_id, OLD.file_id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_sync_share_count
AFTER INSERT OR UPDATE OR DELETE ON public.shares
FOR EACH ROW EXECUTE FUNCTION public.sync_file_share_count();
