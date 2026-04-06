const IMAGE_PREFIX = "image/"
const ADDITIONAL_IMAGE_TYPES = ["text/svg+xml"]

/** Returns true if the given MIME type is an accepted image type. */
export function isAcceptedImageType(mimeType: string): boolean {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase()
  if (!normalized) return false
  return normalized.startsWith(IMAGE_PREFIX) || ADDITIONAL_IMAGE_TYPES.includes(normalized)
}

/**
 * Check if a drag-leave event is leaving the component (not just entering a child).
 * Returns true if dragging has actually left the component boundary.
 */
export function isDragLeavingComponent(relatedTarget: EventTarget | null, currentTarget: HTMLElement): boolean {
  if (!relatedTarget) return true
  return !currentTarget.contains(relatedTarget as Node)
}
