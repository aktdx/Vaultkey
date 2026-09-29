import { describe, expect, it } from 'vitest'
import { createSecureViewerDeepLink } from './secureViewerHandoff'

describe('secure viewer deep link', () => {
  it('contains the share identifier and a non-secret challenge only', () => {
    const link = createSecureViewerDeepLink(
      '2b93a014-f059-4d25-b2a1-c77fdb1df012',
      'A'.repeat(43),
    )
    expect(link).toBe(`vaultkey://share/2b93a014-f059-4d25-b2a1-c77fdb1df012?nonce=${'A'.repeat(43)}`)
    expect(link).not.toContain('key=')
  })

  it('rejects malformed identifiers and challenges', () => {
    expect(() => createSecureViewerDeepLink('not-a-share-id', 'A'.repeat(43))).toThrow()
    expect(() => createSecureViewerDeepLink('2b93a014-f059-4d25-b2a1-c77fdb1df012', 'secret')).toThrow()
  })
})