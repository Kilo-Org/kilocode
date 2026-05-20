/**
 * b64.ts — URL-safe Base64 + FNV-1a checksum
 *
 * ⚠ b64Enc normalizes `\` → `/` for cross-platform path fingerprinting.
 *   If `\` must be preserved, pre-encode manually.
 * ⚠ Uses atob/btoa (Bun/Node safe, may chunk-fail on >100KB in browsers).
 */

export function b64Enc(val: string): string {
  const norm = val.replace(/\\/g, "/") // path normalization
  const bytes = new TextEncoder().encode(norm)
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join("")
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export function b64Dec(val: string): string {
  const bin = atob(val.replace(/-/g, "+").replace(/_/g, "/"))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** FNV-1a 32-bit hash as base-36. Returns undefined for empty input. */
export function fnv1a(s: string): string | undefined {
  if (!s) return undefined
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Hashes 5 evenly-spaced 4KB windows for large strings. Returns `"len:h1:h2:..."`. */
export function sampledHash(s: string, limit = 500_000): string | undefined {
  if (!s) return undefined
  if (s.length <= limit) return fnv1a(s)
  const sz = 4096
  const pts = [
    0,
    (s.length * 0.25) | 0,
    (s.length * 0.5) | 0,
    (s.length * 0.75) | 0,
    s.length - sz,
  ]
  const parts = pts
    .map((p) => {
      const start = Math.max(0, Math.min(s.length - sz, p - (sz >> 1)))
      return fnv1a(s.slice(start, start + sz)) ?? ""
    })
    .join(":")
  return `${s.length}:${parts}`
}
