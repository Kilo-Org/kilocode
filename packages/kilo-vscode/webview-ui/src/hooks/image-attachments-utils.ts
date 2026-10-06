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

/** True for a file part that the prompt attaches as data: an image or a dropped text file. */
export function isDataAttachment(file: { mime: string; url: string }): boolean {
  if (!file.url.startsWith("data:")) return false
  return file.mime.startsWith("image/") || file.mime === "text/plain"
}
