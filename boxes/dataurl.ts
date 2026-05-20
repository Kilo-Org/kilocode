/**
 * dataurl.ts — Decode data: URLs to string
 * Zero deps.
 *
 * decode("data:text/plain;base64,aGVsbG8=") → "hello"
 */
export function decode(url: string): string {
  const i = url.indexOf(",")
  if (i === -1) return ""
  const head = url.slice(0, i)
  const body = url.slice(i + 1)
  if (head.includes(";base64")) return Buffer.from(body, "base64").toString("utf8")
  return decodeURIComponent(body)
}
