-- ============================================================
-- VaultKey — Supabase Storage Setup
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- (AFTER running schema.sql)
-- ============================================================

-- ── 1. CREATE THE STORAGE BUCKET ─────────────────────────────────────────
-- This creates the private 'encrypted-files' bucket.
-- You can also do this in the Supabase Dashboard → Storage → New Bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'encrypted-files',
  'encrypted-files',
  false,                              -- PRIVATE — no public URL access
  524288000,                          -- 500 MB max file size
  ARRAY['application/octet-stream']  -- only encrypted blobs
)
ON CONFLICT (id) DO NOTHING;


-- ── 2. STORAGE POLICIES ───────────────────────────────────────────────────

-- Authenticated users can UPLOAD files under their own user_id folder
CREATE POLICY "Authenticated upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'encrypted-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Authenticated users can READ/DOWNLOAD their own files
CREATE POLICY "Owner download"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'encrypted-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Authenticated users can DELETE their own files
CREATE POLICY "Owner delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'encrypted-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ── PUBLIC DOWNLOAD via Edge Function ─────────────────────────────────────
-- When a share recipient downloads a file, the request goes through
-- an Edge Function (supabase/functions/download/index.ts) which uses the
-- SERVICE ROLE key to fetch the object — so no anon storage policy needed.
-- The Edge Function enforces: token valid + not expired + not revoked + within limit.
