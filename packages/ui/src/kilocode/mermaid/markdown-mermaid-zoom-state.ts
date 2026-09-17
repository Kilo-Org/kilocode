export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 8
export const ZOOM_FACTOR = 1.25

export function clampZoom(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

// Negative delta (wheel up or zoom-in intent) magnifies, positive shrinks.
export function zoomBy(value: number, delta: number) {
  return clampZoom(delta < 0 ? value * ZOOM_FACTOR : value / ZOOM_FACTOR)
}

export function zoomLabel(value: number) {
  return `${Math.round(value * 100)}%`
}
