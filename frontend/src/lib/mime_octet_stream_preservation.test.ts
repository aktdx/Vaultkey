/**
 * Preservation tests — resolveMimeType: specific types must not be disturbed.
 *
 * Property 2: Preservation — Specific MIME Types Are Not Overridden
 *
 * These tests MUST PASS on both unfixed and fixed code. They establish the
 * regression baseline: anything that already works correctly must keep working
 * after the fix in task 3.2 is applied.
 *
 * Inputs where isBugCondition is FALSE:
 *   - serverMimeType is specific and non-generic  → return it unchanged
 *   - serverMimeType is null/undefined/empty      → extension lookup fires
 *   - serverMimeType is octet-stream + unknown ext → octet-stream is kept
 */

import { describe, it, expect } from 'vitest'
import { resolveMimeType } from './crypto'

describe('resolveMimeType — preservation: inputs outside the bug condition', () => {
  // ── Specific server types are returned unchanged ──────────────────────────

  it('returns application/pdf when server explicitly sends application/pdf', () => {
    expect(resolveMimeType('application/pdf', 'report.pdf')).toBe('application/pdf')
  })

  it('returns image/png when server explicitly sends image/png', () => {
    expect(resolveMimeType('image/png', 'photo.png')).toBe('image/png')
  })

  it('returns image/jpeg when server explicitly sends image/jpeg', () => {
    expect(resolveMimeType('image/jpeg', 'photo.jpg')).toBe('image/jpeg')
  })

  it('returns text/plain when server explicitly sends text/plain', () => {
    expect(resolveMimeType('text/plain', 'notes.txt')).toBe('text/plain')
  })

  it('returns application/json when server explicitly sends application/json', () => {
    expect(resolveMimeType('application/json', 'data.json')).toBe('application/json')
  })

  it('returns text/markdown when server explicitly sends text/markdown', () => {
    expect(resolveMimeType('text/markdown', 'README.md')).toBe('text/markdown')
  })

  // ── null / undefined / empty → extension lookup fires ────────────────────

  it('falls back to application/pdf from extension when server sends null', () => {
    expect(resolveMimeType(null, 'report.pdf')).toBe('application/pdf')
  })

  it('falls back to image/png from extension when server sends undefined', () => {
    expect(resolveMimeType(undefined, 'photo.png')).toBe('image/png')
  })

  it('falls back to application/pdf from extension when server sends empty string', () => {
    expect(resolveMimeType('', 'report.pdf')).toBe('application/pdf')
  })

  it('falls back to application/pdf from extension when server sends whitespace', () => {
    expect(resolveMimeType('   ', 'report.pdf')).toBe('application/pdf')
  })

  it('returns octet-stream when server sends null and extension is unknown', () => {
    expect(resolveMimeType(null, 'archive.xyz')).toBe('application/octet-stream')
  })

  // ── octet-stream + unknown extension → octet-stream kept (correct final fallback) ─

  it('keeps octet-stream when extension has no mapping (archive.xyz)', () => {
    expect(resolveMimeType('application/octet-stream', 'archive.xyz')).toBe('application/octet-stream')
  })

  it('keeps octet-stream when filename has no extension at all', () => {
    expect(resolveMimeType('application/octet-stream', 'Makefile')).toBe('application/octet-stream')
  })

  it('keeps octet-stream when filename is empty and server sends null', () => {
    expect(resolveMimeType(null, '')).toBe('application/octet-stream')
  })
})
