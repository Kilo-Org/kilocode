/**
 * net.ts — Network status checks
 * Zero deps.
 *
 * online() → true/false
 * proxied() → true/false
 */
export function online(): boolean {
  const n = globalThis.navigator
  if (!n || typeof n.onLine !== "boolean") return true
  return n.onLine
}

export function proxied(): boolean {
  return !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy)
}
