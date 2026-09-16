export const MIN_PANEL_WIDTH = 360
const DEFAULT_PANEL_WIDTH_RATIO = 0.5
const MAX_PANEL_WIDTH_RATIO = 0.8
export const SIDE_RESIZE_INTERVAL_MS = 32

type Frame = (callback: (time: number) => void) => number

export enum SidePanel {
  Diff = "diff",
  PR = "pr",
  Terminal = "terminal",
  Subagents = "subagents",
  EditPreview = "edit-preview",
  Documents = "documents",
  Browser = "browser",
}

function viewportWidth(viewport: number): number {
  return Number.isFinite(viewport) && viewport > 0 ? viewport : MIN_PANEL_WIDTH
}

export function minPanelWidth(viewport: number): number {
  const width = viewportWidth(viewport)
  return Math.min(MIN_PANEL_WIDTH, Math.round(width * DEFAULT_PANEL_WIDTH_RATIO))
}

export function maxPanelWidth(viewport: number): number {
  const width = viewportWidth(viewport)
  return Math.max(minPanelWidth(width), Math.round(width * MAX_PANEL_WIDTH_RATIO))
}

/** Restore or constrain the shared inspector width without trusting saved state. */
export function clampPanelWidth(value: unknown, viewport: number): number {
  const width = viewportWidth(viewport)
  const fallback = Math.round(width * DEFAULT_PANEL_WIDTH_RATIO)
  const candidate = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.round(Math.max(minPanelWidth(width), Math.min(candidate, maxPanelWidth(width))))
}

export function createPanelResize(
  update: (width: number) => void,
  viewport: () => number,
  frame: Frame = requestAnimationFrame,
) {
  let raf: number | undefined
  let pending = 0
  let time = 0
  const flush = (now: number) => {
    if (now - time < SIDE_RESIZE_INTERVAL_MS) {
      raf = frame(flush)
      return
    }
    raf = undefined
    time = now
    update(pending)
  }
  return (width: number) => {
    pending = clampPanelWidth(width, viewport())
    if (raf !== undefined) return
    raf = frame(flush)
  }
}
