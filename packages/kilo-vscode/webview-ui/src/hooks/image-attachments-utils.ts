export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
export const STATIC_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"]
export const IMAGE_MAX_SIDE = 1600
export const IMAGE_MAX_BASE64_BYTES = 1.5 * 1024 * 1024

/** Returns true if the given MIME type is an accepted image type. */
export function isAcceptedImageType(mimeType: string): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(mimeType)
}

/** Returns true for static image formats that can be safely drawn to a canvas. */
export function isStaticImageType(mimeType: string): boolean {
  return STATIC_IMAGE_TYPES.includes(mimeType)
}

/** Returns dimensions scaled down to fit within the maximum side length. */
export function getImageDimensions(width: number, height: number, maxSide = IMAGE_MAX_SIDE) {
  if (width <= maxSide && height <= maxSide) return { width, height }

  const scale = Math.min(maxSide / width, maxSide / height)
  return {
    width: Math.max(1, Math.min(maxSide, Math.round(width * scale))),
    height: Math.max(1, Math.min(maxSide, Math.round(height * scale))),
  }
}

/** Returns the base64 payload length produced by encoding the given byte count. */
export function getBase64ByteLength(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0
  return Math.ceil(bytes / 3) * 4
}

/**
 * Check if a drag-leave event is leaving the component (not just entering a child).
 * Returns true if dragging has actually left the component boundary.
 */
export function isDragLeavingComponent(relatedTarget: EventTarget | null, currentTarget: HTMLElement): boolean {
  if (!relatedTarget) return true
  return !currentTarget.contains(relatedTarget as Node)
}
