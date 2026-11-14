export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

/** Returns true if the given MIME type is an accepted image type. */
export function isAcceptedImageType(mimeType: string): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(mimeType)
}

/**
 * Check if a drag-leave event is leaving the component (not just entering a child).
 * Returns true if dragging has actually left the component boundary.
 */
export function isDragLeavingComponent(relatedTarget: EventTarget | null, currentTarget: HTMLElement): boolean {
  if (!relatedTarget) return true
  return !currentTarget.contains(relatedTarget as Node)
}

/** Largest dropped text file to attach. The model reads all of its text. */
export const MAX_TEXT_BYTES = 256 * 1024

const decoder = new TextDecoder("utf-8", { fatal: true })

/**
 * Encode the bytes of a dropped file as a text/plain data URL, which the
 * backend reads as text. Returns undefined for binary data (NUL bytes or
 * invalid UTF-8).
 */
export function textDataUrl(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined
  try {
    decoder.decode(bytes)
  } catch {
    return undefined
  }
  const chars = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
  return `data:text/plain;base64,${btoa(chars)}`
}

/** Decode the UTF-8 text of a base64 or percent-encoded data URL. */
export function dataUrlText(url: string): string {
  const comma = url.indexOf(",")
  const data = url.slice(comma + 1)
  if (!url.slice(0, comma).endsWith(";base64")) return decodeURIComponent(data)
  return new TextDecoder().decode(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)))
}

/**
 * True for a file part that the prompt attaches as data: an image or a dropped
 * text file. Mention context (terminal, git changes, worktree) is also a
 * text/plain data URL, but it has a mention span. The prompt collects it again
 * from the mention on send, so it is not an attachment. This is the same rule
 * as the attachment tiles of the transcript.
 */
export function isDataAttachment(file: { mime: string; url: string; source?: { text?: { start: number } } }): boolean {
  if (!file.url.startsWith("data:")) return false
  if (file.mime.startsWith("image/")) return true
  return file.mime === "text/plain" && file.source?.text?.start === undefined
}
