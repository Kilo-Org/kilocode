/**
 * mime.ts — Sniff MIME type from magic bytes
 * Zero deps.
 *
 * sniff(new Uint8Array([0x89, 0x50, ...]), "application/octet-stream") → "image/png"
 */
function has(b: Uint8Array, p: number[]) { return p.every((v, i) => b[i] === v) }

export function sniff(bytes: Uint8Array, fallback: string): string {
  if (has(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (has(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (has(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (has(bytes, [0x42, 0x4d])) return "image/bmp"
  if (has(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
  if (has(bytes, [0x52, 0x49, 0x46, 0x46]) && has(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) return "image/webp"
  return fallback
}

export function isImage(mime: string) { return mime.startsWith("image/") && mime !== "image/svg+xml" }
export function isMedia(mime: string) { return mime.startsWith("image/") || mime === "application/pdf" }
