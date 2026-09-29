const VIEWER_ORIGIN = 'http://127.0.0.1:41739'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '='))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function createSecureViewerDeepLink(shareId: string, nonce: string): string {
  if (!UUID_PATTERN.test(shareId)) throw new Error('Invalid share identifier.')
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw new Error('Invalid handoff challenge.')
  return `vaultkey://share/${shareId}?nonce=${nonce}`
}

export async function transferKeyToSecureViewer(
  shareId: string,
  nonce: string,
  encryptionKey: string,
): Promise<void> {
  if (!UUID_PATTERN.test(shareId)) throw new Error('Invalid share identifier.')

  const challengeUrl = new URL('/challenge', VIEWER_ORIGIN)
  challengeUrl.searchParams.set('share_id', shareId)
  challengeUrl.searchParams.set('nonce', nonce)

  let challenge: { public_key: string } | null = null
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(challengeUrl, { cache: 'no-store', credentials: 'omit' })
      if (response.ok) {
        challenge = await response.json() as { public_key: string }
        break
      }
    } catch {
      // The protocol handler may still be starting its local bridge.
    }
    await new Promise(resolve => window.setTimeout(resolve, 300))
  }
  if (!challenge) throw new Error('VaultKey Secure Viewer did not start. The document was not transferred.')

  const publicKey = await crypto.subtle.importKey(
    'spki',
    decodeBase64Url(challenge.public_key).buffer as ArrayBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    decodeBase64Url(encryptionKey).buffer as ArrayBuffer,
  )

  const response = await fetch(new URL('/handoff', VIEWER_ORIGIN), {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      share_id: shareId,
      nonce,
      encrypted_key: encodeBase64Url(new Uint8Array(encryptedKey)),
    }),
  })
  if (!response.ok) throw new Error('Secure key handoff failed. The document was not displayed.')
}

export function createHandoffNonce(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}