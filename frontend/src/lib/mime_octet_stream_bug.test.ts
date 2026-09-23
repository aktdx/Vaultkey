/**
 * Bug condition exploration tests — MIME type octet-stream override bug.
 *
 * Property 1: Bug Condition — Generic MIME Type Not Overridden by Extension
 *
 * These tests encode the EXPECTED (correct) behaviour and are intentionally
 * designed to FAIL on unfixed code, confirming root cause #2.
 *
 * DO NOT fix these tests or the production code when they fail here.
 * They will become green after the fix is applied in task 3.2.
 *
 * Root cause under test:
 *   `resolveMimeType()` in crypto.ts returns `serverMimeType.trim()` for any
 *   non-empty server value. Because `"application/octet-stream"` is truthy,
 *   the EXTENSION_TO_MIME lookup is never reached.
 */

import { describe, it, expect } from 'vitest'
import { resolveMimeType } from './crypto'

describe('resolveMimeType — bug condition: octet-stream should not override known extension', () => {
  // ── Bug condition cases — MUST FAIL on unfixed code ──────────────────────

  it('returns application/pdf for report.pdf when server sends octet-stream', () => {
    const result = resolveMimeType('application/octet-stream', 'report.pdf')
    expect(result, 'BUG CONFIRMED: octet-stream not overridden by .pdf extension').toBe('application/pdf')
  })

  it('returns image/png for photo.png when server sends octet-stream', () => {
    const result = resolveMimeType('application/octet-stream', 'photo.png')
    expect(result, 'BUG CONFIRMED: octet-stream not overridden by .png extension').toBe('image/png')
  })

  it('returns image/jpeg for photo.jpg when server sends octet-stream', () => {
    expect(resolveMimeType('application/octet-stream', 'photo.jpg')).toBe('image/jpeg')
  })

  it('returns text/plain for notes.txt when server sends octet-stream', () => {
    expect(resolveMimeType('application/octet-stream', 'notes.txt')).toBe('text/plain')
  })

  it('returns application/json for data.json when server sends octet-stream', () => {
    expect(resolveMimeType('application/octet-stream', 'data.json')).toBe('application/json')
  })

  // ── Boundary: unknown extension — must pass even on UNFIXED code ─────────

  it('returns application/octet-stream for archive.xyz (no extension mapping)', () => {
    // No extension match → octet-stream is the correct final fallback.
    expect(resolveMimeType('application/octet-stream', 'archive.xyz')).toBe('application/octet-stream')
  })
})
