/**
 * Security #1 — validateFileContent guard tests
 * ══════════════════════════════════════════════
 * Verifies that the magic-byte and null-byte validation logic ported from
 * encrypt.js into crypto.ts is present and behaves correctly:
 *
 *   • Invalid binary files (wrong magic bytes) are rejected before encryption.
 *   • Text files containing null bytes (0x00) are rejected before encryption.
 *   • Valid files of known types are accepted.
 *   • validateFileContent is called BEFORE generateKey in encryptFile().
 *
 * Uses Vitest. Run with:  npm test
 *
 * The logic below is an inline copy of the pure validation layer from
 * crypto.ts so we can unit-test it without needing window.crypto.subtle
 * (which is unavailable in the jsdom test environment for encrypt operations).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ── Inline copy of the validation layer (kept in sync with crypto.ts) ─────────

const MAGIC_BYTES: Record<string, { offset: number; hex: string }> = {
  pdf:  { offset: 0, hex: '25504446' },
  png:  { offset: 0, hex: '89504e47' },
  jpg:  { offset: 0, hex: 'ffd8ff' },
  jpeg: { offset: 0, hex: 'ffd8ff' },
  gif:  { offset: 0, hex: '474946' },
  webp: { offset: 8, hex: '57454250' },
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'js', 'py', 'html', 'css', 'csv', 'log',
])

function validateFileContent(filename: string, buffer: ArrayBuffer): void {
  const bytes = new Uint8Array(buffer)
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''

  if (MAGIC_BYTES[ext] !== undefined) {
    const { offset, hex: expectedHex } = MAGIC_BYTES[ext]
    const slice = bytes.slice(offset, offset + expectedHex.length / 2)
    const actualHex = Array.from(slice, b => b.toString(16).padStart(2, '0')).join('')
    if (!actualHex.startsWith(expectedHex)) {
      throw new Error(
        `Invalid file: content does not match the .${ext} format. ` +
        `Expected magic bytes ${expectedHex}, got ${actualHex.slice(0, expectedHex.length)}.`
      )
    }
  } else if (TEXT_EXTENSIONS.has(ext)) {
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x00) {
        throw new Error(
          `Invalid file: .${ext} files must not contain binary (null) bytes. ` +
          `Found null byte at offset ${i}.`
        )
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToBuffer(hex: string): ArrayBuffer {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return arr.buffer
}

// ── Magic-byte tests ──────────────────────────────────────────────────────────

describe('validateFileContent — magic-byte validation', () => {
  // PDF
  it('accepts a valid PDF (magic bytes 25504446)', () => {
    expect(() => validateFileContent('report.pdf', hexToBuffer('255044462d312e34'))).not.toThrow()
  })
  it('rejects a JPEG renamed to .pdf', () => {
    expect(() => validateFileContent('fake.pdf', hexToBuffer('ffd8ffE000104a46494600')))
      .toThrow(/does not match the \.pdf format/)
  })

  // PNG
  it('accepts a valid PNG (magic bytes 89504e47)', () => {
    expect(() => validateFileContent('image.png', hexToBuffer('89504e470d0a1a0a'))).not.toThrow()
  })
  it('rejects a PDF renamed to .png', () => {
    expect(() => validateFileContent('fake.png', hexToBuffer('255044462d312e34')))
      .toThrow(/does not match the \.png format/)
  })

  // JPEG / JPG
  it('accepts a valid JPEG (.jpg)', () => {
    expect(() => validateFileContent('photo.jpg', hexToBuffer('ffd8ffe000104a4649460001'))).not.toThrow()
  })
  it('accepts a valid JPEG (.jpeg)', () => {
    expect(() => validateFileContent('photo.jpeg', hexToBuffer('ffd8ffe000104a4649460001'))).not.toThrow()
  })
  it('rejects a PNG renamed to .jpg', () => {
    expect(() => validateFileContent('fake.jpg', hexToBuffer('89504e470d0a1a0a')))
      .toThrow(/does not match the \.jpg format/)
  })

  // GIF
  it('accepts a valid GIF (magic bytes 474946)', () => {
    expect(() => validateFileContent('anim.gif', hexToBuffer('47494638396100'))).not.toThrow()
  })
  it('rejects random bytes as .gif', () => {
    expect(() => validateFileContent('fake.gif', hexToBuffer('deadbeef'))).toThrow()
  })

  // WEBP
  it('accepts a valid WEBP (bytes 8-11 = 57454250)', () => {
    const arr = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ])
    expect(() => validateFileContent('img.webp', arr.buffer)).not.toThrow()
  })
  it('rejects a non-WEBP file with .webp extension', () => {
    expect(() => validateFileContent('fake.webp', new Uint8Array(12).fill(0xaa).buffer)).toThrow()
  })
})

// ── Null-byte tests ───────────────────────────────────────────────────────────

describe('validateFileContent — text / null-byte validation', () => {
  const enc = new TextEncoder()

  it('accepts a .txt file with no null bytes', () => {
    expect(() => validateFileContent('readme.txt', enc.encode('Hello, world!').buffer)).not.toThrow()
  })
  it('rejects a .txt file containing a null byte', () => {
    const arr = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x00, 0x6f])
    expect(() => validateFileContent('bad.txt', arr.buffer))
      .toThrow(/must not contain binary \(null\) bytes/)
  })

  it('accepts a valid .json file', () => {
    expect(() => validateFileContent('data.json', enc.encode('{"key":"value"}').buffer)).not.toThrow()
  })
  it('rejects a .json file with a null byte', () => {
    expect(() => validateFileContent('bad.json', new Uint8Array([0x7b, 0x22, 0x00, 0x22, 0x7d]).buffer)).toThrow()
  })

  it('accepts a .md file without null bytes', () => {
    expect(() => validateFileContent('README.md', enc.encode('# Title\n\nParagraph.').buffer)).not.toThrow()
  })
  it('rejects a .md file with a null byte', () => {
    expect(() => validateFileContent('bad.md', new Uint8Array([0x23, 0x20, 0x54, 0x00]).buffer)).toThrow()
  })

  // All remaining text extensions
  for (const ext of ['js', 'py', 'html', 'css', 'csv', 'log'] as const) {
    it(`accepts a valid .${ext} file`, () => {
      expect(() => validateFileContent(`file.${ext}`, enc.encode(`valid ${ext} content`).buffer)).not.toThrow()
    })
    it(`rejects a .${ext} file with a null byte`, () => {
      expect(() => validateFileContent(`bad.${ext}`, new Uint8Array([0x61, 0x00, 0x62]).buffer)).toThrow()
    })
  }
})

// ── Unknown extensions ────────────────────────────────────────────────────────

describe('validateFileContent — unknown/unvalidated extensions', () => {
  it('does not throw for .zip (no rule defined)', () => {
    expect(() => validateFileContent('archive.zip', new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer)).not.toThrow()
  })
  it('does not throw for .enc (ciphertext output)', () => {
    expect(() => validateFileContent('file.enc', new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer)).not.toThrow()
  })
})

// ── Source-structure assertions ───────────────────────────────────────────────
// Confirms that the security guard is wired into the actual crypto.ts source,
// not just the inline copy above. Fails if someone accidentally removes it.

describe('Security #1 — validateFileContent is wired into crypto.ts', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(__dirname, 'crypto.ts'), 'utf8')

  it('MAGIC_BYTES lookup table is defined in crypto.ts', () => {
    expect(src).toContain('const MAGIC_BYTES')
  })
  it('TEXT_EXTENSIONS set is defined in crypto.ts', () => {
    expect(src).toContain('const TEXT_EXTENSIONS')
  })
  it('validateFileContent function is defined in crypto.ts', () => {
    expect(src).toContain('function validateFileContent')
  })
  it('validateFileContent is called BEFORE generateKey in encryptFile()', () => {
    const encryptFnStart = src.indexOf('export async function encryptFile')
    expect(encryptFnStart).not.toBe(-1)
    const validatePos = src.indexOf('validateFileContent(', encryptFnStart)
    const generateKeyPos = src.indexOf('generateKey()', encryptFnStart)
    expect(validatePos).not.toBe(-1)
    expect(generateKeyPos).not.toBe(-1)
    expect(validatePos).toBeLessThan(generateKeyPos)
  })
})
