const SCROLLBAR_WIDTH = 15
const MIN_COLS = 2
const MIN_ROWS = 1
const metricsCache = new Map<string, { width: number; height: number }>()

/** Measure and cache character cell size on the physical-pixel grid. */
export function measureFontCell(font: { fontFamily: string; fontSize: number }): { width: number; height: number } | undefined {
  if (typeof window === "undefined" || typeof document === "undefined" || font.fontSize <= 0) return undefined
  const dpr = window.devicePixelRatio || 1
  const key = `${font.fontSize}:${dpr}:${font.fontFamily}`
  const cached = metricsCache.get(key)
  if (cached) return cached
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) return undefined
  ctx.font = `${font.fontSize * dpr}px ${font.fontFamily}`
  const w = ctx.measureText("M")
  const h = ctx.measureText("Mg")
  const ascent =
    h.fontBoundingBoxAscent || h.actualBoundingBoxAscent || w.actualBoundingBoxAscent || font.fontSize * dpr * 0.8
  const descent =
    h.fontBoundingBoxDescent || h.actualBoundingBoxDescent || w.actualBoundingBoxDescent || font.fontSize * dpr * 0.2
  const cell = {
    width: Math.max(1, Math.round(w.width)) / dpr,
    height: Math.max(1, Math.round(ascent + descent)) / dpr,
  }
  metricsCache.set(key, cell)
  return cell
}

/**
 * Measure and cache character cell size on the physical-pixel grid so new
 * terminals spawn at exact container dimensions on first paint without an
 * 80x24 -> resize double allocation.
 */
export function measureHostDimensions(
  host: HTMLElement,
  font: { fontFamily: string; fontSize: number },
): { cols: number; rows: number } | undefined {
  if (typeof window === "undefined" || host.clientWidth <= 1 || host.clientHeight <= 1) return undefined
  const cell = measureFontCell(font)
  if (!cell) return undefined
  const style = window.getComputedStyle(host)
  const padX = (Number.parseInt(style.paddingLeft, 10) || 0) + (Number.parseInt(style.paddingRight, 10) || 0)
  const padY = (Number.parseInt(style.paddingTop, 10) || 0) + (Number.parseInt(style.paddingBottom, 10) || 0)
  const availW = host.clientWidth - padX - SCROLLBAR_WIDTH
  const availH = host.clientHeight - padY
  if (availW <= 0 || availH <= 0) return undefined
  return {
    cols: Math.max(MIN_COLS, Math.floor(availW / cell.width)),
    rows: Math.max(MIN_ROWS, Math.floor(availH / cell.height)),
  }
}

/**
 * Estimate initial terminal geometry from the active container so PTY spawn
 * matches libghostty's physical-pixel grid before the first fit pass commits.
 */
export function measureInitialDimensions(
  placement: "tab" | "side",
  font: { fontFamily: string; fontSize: number },
): { cols: number; rows: number } | undefined {
  if (typeof document === "undefined") return undefined
  const selector =
    placement === "side"
      ? ".am-side-terminal-layer, .am-side-terminal, .am-diff-panel-wrapper"
      : ".am-terminal-layer, .am-detail-stack"
  const host = document.querySelector(selector) as HTMLElement | null
  const rect = host?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return undefined
  const cell = measureFontCell(font)
  const cellWidth = cell?.width ?? (font.fontSize > 0 ? font.fontSize * 0.6 : 7.2)
  const cellHeight = cell?.height ?? (font.fontSize > 0 ? font.fontSize * 1.2 : 14.4)
  const availableWidth = Math.max(0, rect.width - 31)
  const availableHeight = Math.max(0, rect.height - 16)
  return {
    cols: Math.max(MIN_COLS, Math.floor(availableWidth / cellWidth)),
    rows: Math.max(MIN_ROWS, Math.floor(availableHeight / cellHeight)),
  }
}
