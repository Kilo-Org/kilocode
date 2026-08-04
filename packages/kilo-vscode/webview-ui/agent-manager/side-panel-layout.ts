export const MIN_PANEL_WIDTH = 360
const DEFAULT_PANEL_WIDTH_RATIO = 0.5
const MAX_PANEL_WIDTH_RATIO = 0.8

export function maxPanelWidth(viewport: number): number {
  const width = Number.isFinite(viewport) && viewport > 0 ? viewport : MIN_PANEL_WIDTH
  return Math.max(MIN_PANEL_WIDTH, Math.round(width * MAX_PANEL_WIDTH_RATIO))
}

/** Restore or constrain the shared inspector width without trusting saved state. */
export function clampPanelWidth(value: unknown, viewport: number): number {
  const width = Number.isFinite(viewport) && viewport > 0 ? viewport : MIN_PANEL_WIDTH
  const fallback = Math.round(width * DEFAULT_PANEL_WIDTH_RATIO)
  const candidate = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(candidate, maxPanelWidth(width))))
}
