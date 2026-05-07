/**
 * Minimal ULID generator for the extension host.
 *
 * Produces a 26-character Crockford Base32 identifier: 10 time chars
 * followed by 16 random chars. The kilo-chat worker validates clientId
 * as a ULID, so `generateClientId` must emit only Crockford-legal
 * characters — `toString(36)` is NOT safe because base36 includes
 * I, L, O, and U which are excluded from Crockford Base32.
 */

// Crockford Base32 — no I, L, O, U (reduces transcription ambiguity).
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const ENCODING_LEN = ENCODING.length
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(ts: number): string {
  let out = ""
  let n = ts
  for (let i = 0; i < TIME_LEN; i++) {
    const mod = n % ENCODING_LEN
    out = ENCODING[mod] + out
    n = (n - mod) / ENCODING_LEN
  }
  return out
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN)
  globalThis.crypto.getRandomValues(bytes)
  let out = ""
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ENCODING[bytes[i]! % ENCODING_LEN]
  }
  return out
}

/** Generate a ULID at the current epoch. */
export function ulid(): string {
  return encodeTime(Date.now()) + encodeRandom()
}
