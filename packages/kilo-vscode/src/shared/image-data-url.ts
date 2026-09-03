/**
 * The exact shape of data URL the host can turn into a file on disk (see
 * `parseImage` in ../image-preview.ts). Shared with the webview so a click
 * is only routed to the host preview when the host can actually decode it —
 * otherwise the webview keeps its own modal fallback.
 */
const PATTERN = /^data:(image\/[A-Za-z0-9.+-]+);base64,/

export function imageMime(url: string): string | undefined {
  return url.match(PATTERN)?.[1]
}
