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
