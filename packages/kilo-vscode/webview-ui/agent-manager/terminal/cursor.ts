import { CellFlags, type GhosttyCell, type GhosttyTerminal, type ITheme, type Terminal } from "ghostty-web"

export type CursorStyle = "block" | "underline" | "bar"

export interface CursorTarget {
  x: number
  y: number
  visible: boolean
}

export interface BlinkResult {
  opacity: number
  /** True while opacity is actively changing and needs rAF frames. */
  animating: boolean
  /** Milliseconds until the next animation phase starts, or undefined when stopped. */
  nextWakeMs: number | undefined
}

export interface GlideState {
  fromX: number
  fromY: number
  toX: number
  toY: number
  startMs: number
  active: boolean
}

export interface GlideSample {
  x: number
  y: number
  stretchX: number
  active: boolean
}

const SOLID_HOLD_MS = 480
const FADE_OUT_MS = 200
const DIM_HOLD_MS = 280
const FADE_IN_MS = 200
const BLINK_PERIOD_MS = SOLID_HOLD_MS + FADE_OUT_MS + DIM_HOLD_MS + FADE_IN_MS
const DIM_OPACITY = 0.14
export const CURSOR_IDLE_STOP_MS = 10_000
export const CURSOR_GLIDE_MS = 68
const MAX_GLIDE_ROW_JUMP = 12

function cosineEase(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)))
}

function easeOutCubic(t: number): number {
  const inv = 1 - Math.max(0, Math.min(1, t))
  return 1 - inv * inv * inv
}

/**
 * Compute smooth breathing cursor opacity and the next scheduling step.
 * - Unfocused or steady mode: static full opacity (unfocused renders as hollow outline).
 * - After `idleStopMs` without typing/movement: settles at steady solid `1.0` and stops.
 * - During flat holds, returns `animating: false` with `nextWakeMs` so no rAFs burn while flat.
 */
export function computeBlinkState(
  elapsedMs: number,
  opts: { blinking: boolean; focused: boolean; idleStopMs?: number; reducedMotion?: boolean },
): BlinkResult {
  const idleStop = opts.idleStopMs ?? CURSOR_IDLE_STOP_MS
  if (!opts.focused || !opts.blinking) return { opacity: 1, animating: false, nextWakeMs: undefined }
  const elapsed = Math.max(0, elapsedMs)
  if (elapsed >= idleStop) return { opacity: 1, animating: false, nextWakeMs: undefined }

  const phase = elapsed % BLINK_PERIOD_MS
  if (opts.reducedMotion) {
    const half = BLINK_PERIOD_MS / 2
    const remaining = idleStop - elapsed
    if (phase < half) return { opacity: 1, animating: false, nextWakeMs: Math.min(half - phase, remaining) }
    return { opacity: 0, animating: false, nextWakeMs: Math.min(BLINK_PERIOD_MS - phase, remaining) }
  }

  if (phase < SOLID_HOLD_MS) {
    return { opacity: 1, animating: false, nextWakeMs: Math.min(SOLID_HOLD_MS - phase, idleStop - elapsed) }
  }
  const fadeOutEnd = SOLID_HOLD_MS + FADE_OUT_MS
  if (phase < fadeOutEnd) {
    const t = (phase - SOLID_HOLD_MS) / FADE_OUT_MS
    return { opacity: 1 - (1 - DIM_OPACITY) * cosineEase(t), animating: true, nextWakeMs: undefined }
  }
  const dimHoldEnd = fadeOutEnd + DIM_HOLD_MS
  if (phase < dimHoldEnd) {
    return { opacity: DIM_OPACITY, animating: false, nextWakeMs: Math.min(dimHoldEnd - phase, idleStop - elapsed) }
  }
  const t = (phase - dimHoldEnd) / FADE_IN_MS
  return { opacity: DIM_OPACITY + (1 - DIM_OPACITY) * cosineEase(t), animating: true, nextWakeMs: undefined }
}

/** Start or snap a cursor glide when the logical terminal cell moves. */
export function startCursorGlide(
  previous: GlideState | undefined,
  target: { x: number; y: number },
  nowMs: number,
  allowGlide: boolean,
): GlideState {
  if (!previous || !allowGlide || Math.abs(target.y - previous.toY) > MAX_GLIDE_ROW_JUMP) {
    return { fromX: target.x, fromY: target.y, toX: target.x, toY: target.y, startMs: nowMs, active: false }
  }
  const current = sampleCursorGlide(previous, nowMs)
  if (current.x === target.x && current.y === target.y) {
    return { fromX: target.x, fromY: target.y, toX: target.x, toY: target.y, startMs: nowMs, active: false }
  }
  return { fromX: current.x, fromY: current.y, toX: target.x, toY: target.y, startMs: nowMs, active: true }
}

/** Sample interpolated cell coordinates and subtle horizontal motion stretch. */
export function sampleCursorGlide(state: GlideState, nowMs: number): GlideSample {
  if (!state.active) return { x: state.toX, y: state.toY, stretchX: 0, active: false }
  const t = (nowMs - state.startMs) / CURSOR_GLIDE_MS
  if (t >= 1) return { x: state.toX, y: state.toY, stretchX: 0, active: false }
  const eased = easeOutCubic(Math.max(0, t))
  const x = state.fromX + (state.toX - state.fromX) * eased
  const y = state.fromY + (state.toY - state.fromY) * eased
  const dx = state.toX - state.fromX
  const sameRow = state.fromY === state.toY
  const peak = 4 * Math.max(0, t) * (1 - Math.max(0, t))
  const stretchX = sameRow && Math.abs(dx) >= 1 ? Math.sign(dx) * Math.min(Math.abs(dx) * 0.25, 1.2) * peak : 0
  return { x, y, stretchX, active: true }
}

/** Parse DECSCUSR (`CSI Ps SP q`) cursor style & blink changes from PTY output. */
export function createDecscusrScanner(onChange: (style: CursorStyle, blink: boolean) => void) {
  const decoder = new TextDecoder("utf-8", { fatal: false })
  let tail = ""

  const apply = (ps: string) => {
    const code = ps === "" ? 0 : Number.parseInt(ps, 10)
    if (code === 0 || code === 1) return onChange("block", true)
    if (code === 2) return onChange("block", false)
    if (code === 3) return onChange("underline", true)
    if (code === 4) return onChange("underline", false)
    if (code === 5) return onChange("bar", true)
    if (code === 6) return onChange("bar", false)
  }

  const scan = (text: string) => {
    if (text.length === 0) return
    if (tail.length === 0 && !text.includes(" q")) {
      const start = text.lastIndexOf("\x1b")
      if (start >= 0 && text.length - start <= 5) tail = text.slice(start)
      return
    }
    const input = tail + text
    const regex = /\x1b\[([0-6]?) q/g
    let match: RegExpExecArray | null = null
    let lastEnd = 0
    while ((match = regex.exec(input)) !== null) {
      apply(match[1]!)
      lastEnd = regex.lastIndex
    }
    const rest = input.slice(lastEnd)
    const start = rest.lastIndexOf("\x1b")
    tail = start >= 0 && rest.length - start <= 5 ? rest.slice(start) : ""
  }

  return {
    feed(data: string | Uint8Array) {
      scan(typeof data === "string" ? data : decoder.decode(data, { stream: true }))
    },
    clear() {
      tail = ""
    },
  }
}

let reducedMotionQuery: MediaQueryList | undefined
let reducedMotion = false

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  if (!reducedMotionQuery) {
    reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    reducedMotion = reducedMotionQuery.matches
    reducedMotionQuery.addEventListener?.("change", (event) => {
      reducedMotion = event.matches
    })
  }
  return reducedMotion
}

function cellGlyph(wasmTerm: GhosttyTerminal, row: number, col: number, cell: GhosttyCell): string | undefined {
  if (cell.grapheme_len > 0) return wasmTerm.getGraphemeString(row, col)
  if (cell.codepoint === 0 || cell.codepoint === 32) return undefined
  if (cell.codepoint < 32 || cell.codepoint > 0x10ffff || (cell.codepoint >= 0xd800 && cell.codepoint <= 0xdfff)) {
    return undefined
  }
  return String.fromCodePoint(cell.codepoint)
}

export interface AnimatedCursorController {
  syncFrame(cursor: CursorTarget, viewportY: number): void
  setFocused(focused: boolean): void
  setTheme(theme: ITheme): void
  setStyle(style: CursorStyle, blink: boolean): void
  notifyActivity(): void
  pause(): void
  resume(): void
  dispose(): void
}

/**
 * Dedicated transparent overlay `<canvas>` cursor for a libghostty terminal.
 *
 * Keeps `ghostty-web`'s main text canvas completely free of cursor redraws
 * while delivering smooth cursor glide, breathing fade blink, automatic idle
 * blink stop (0% idle CPU), DECSCUSR shape support, and a crisp hollow outline
 * cursor when unfocused.
 */
export function createAnimatedCursor(opts: {
  term: Terminal
  host: HTMLElement
  theme: ITheme
  style?: CursorStyle
  blink?: boolean
}): AnimatedCursorController {
  const { term, host } = opts
  const overlay = document.createElement("canvas")
  overlay.className = "am-terminal-cursor"
  overlay.setAttribute("aria-hidden", "true")
  host.appendChild(overlay)
  const ctx = overlay.getContext("2d", { alpha: true })

  let cursorColor = opts.theme.cursor ?? "#d4d4d4"
  let cursorAccent = opts.theme.cursorAccent ?? opts.theme.background ?? "#1e1e1e"
  let style: CursorStyle = opts.style ?? "block"
  let blinking = opts.blink ?? true
  let focused = typeof document !== "undefined" && document.hasFocus() && host.contains(document.activeElement)
  let paused = false
  let disposed = false
  let viewportY = 0
  let cursor: CursorTarget = { x: 0, y: 0, visible: false }
  let glide: GlideState | undefined
  let lastActivityMs = performance.now()
  let rafId: number | undefined
  let wakeTimer: ReturnType<typeof setTimeout> | undefined
  let cachedW = 0
  let cachedH = 0
  let cachedDpr = 1
  let dirtyRect: { x: number; y: number; w: number; h: number } | undefined

  const cancelTimers = () => {
    if (rafId !== undefined) cancelAnimationFrame(rafId)
    rafId = undefined
    clearTimeout(wakeTimer)
    wakeTimer = undefined
  }

  const syncGeometry = (): { cellW: number; cellH: number; baseline: number; dpr: number } | undefined => {
    const renderer = term.renderer
    const baseCanvas = renderer?.getCanvas()
    if (!renderer || !baseCanvas || !ctx) return undefined
    const metrics = renderer.getMetrics()
    if (!metrics.width || !metrics.height) return undefined
    // Only touch canvas dimensions on real size/DPR changes; never read offsetLeft/offsetTop
    // here because reading layout properties forces a synchronous DOM reflow every frame.
    if (cachedW !== baseCanvas.width || cachedH !== baseCanvas.height) {
      cachedW = baseCanvas.width
      cachedH = baseCanvas.height
      overlay.width = cachedW
      overlay.height = cachedH
      overlay.style.width = baseCanvas.style.width
      overlay.style.height = baseCanvas.style.height
      cachedDpr = cachedW / (Number.parseFloat(baseCanvas.style.width) || cachedW || 1)
      dirtyRect = undefined
    }
    return { cellW: metrics.width, cellH: metrics.height, baseline: metrics.baseline, dpr: cachedDpr }
  }

  const drawBlockGlyph = (
    wasmTerm: GhosttyTerminal,
    cell: GhosttyCell,
    cellW: number,
    cellH: number,
    baseline: number,
    dpr: number,
    opacity: number,
  ) => {
    if (!ctx || cell.flags & CellFlags.INVISIBLE) return
    const glyph = cellGlyph(wasmTerm, cursor.y, cursor.x, cell)
    if (!glyph) return
    const span = Math.max(1, cell.width || 1)
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.beginPath()
    ctx.rect(cursor.x * cellW, cursor.y * cellH, span * cellW, cellH)
    ctx.clip()
    let fontStyle = ""
    if (cell.flags & CellFlags.ITALIC) fontStyle += "italic "
    if (cell.flags & CellFlags.BOLD) fontStyle += "bold "
    ctx.font = `${fontStyle}${term.options.fontSize}px ${term.options.fontFamily}`
    ctx.textBaseline = "alphabetic"
    ctx.textAlign = "left"
    ctx.globalAlpha = opacity
    ctx.fillStyle = cursorAccent
    ctx.fillText(glyph, cursor.x * cellW, cursor.y * cellH + baseline)
    ctx.restore()
  }

  const paintShape = (sample: GlideSample, geo: { cellW: number; cellH: number; baseline: number; dpr: number }, opacity: number) => {
    if (!ctx) return
    const { cellW, cellH, baseline, dpr } = geo
    const wasmTerm = term.wasmTerm
    const cell = !sample.active && style === "block" ? wasmTerm?.getLine(cursor.y)?.[cursor.x] : undefined
    const cellSpan = cell ? Math.max(1, cell.width || 1) : 1
    const stretchLeft = sample.stretchX < 0 ? sample.stretchX * cellW : 0
    const stretchW = Math.abs(sample.stretchX) * cellW
    const px = Math.round((sample.x * cellW + stretchLeft) * dpr)
    const py = Math.round(sample.y * cellH * dpr)
    const pw = Math.max(1, Math.round((cellSpan * cellW + stretchW) * dpr))
    const ph = Math.max(1, Math.round(cellH * dpr))
    const stroke = Math.max(1, Math.round(dpr))
    const pad = stroke + 2
    dirtyRect = { x: Math.max(0, px - pad), y: Math.max(0, py - pad), w: pw + pad * 2, h: ph + pad * 2 }

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    if (!focused) {
      // Crisp hollow outline when unfocused (matches native Ghostty & xterm cursorInactiveStyle: "outline").
      ctx.globalAlpha = 0.85
      ctx.strokeStyle = cursorColor
      ctx.lineWidth = stroke
      const inset = stroke / 2
      if (style === "underline") {
        const thick = Math.max(1, Math.round(dpr * 1.5))
        ctx.fillStyle = cursorColor
        ctx.globalAlpha = 0.45
        ctx.fillRect(px, py + ph - thick, pw, thick)
      } else if (style === "bar") {
        const thick = Math.max(1, Math.round(dpr * 1.5))
        ctx.fillStyle = cursorColor
        ctx.globalAlpha = 0.45
        ctx.fillRect(px, py, thick, ph)
      } else {
        ctx.strokeRect(px + inset, py + inset, Math.max(1, pw - stroke), Math.max(1, ph - stroke))
      }
      ctx.restore()
      return
    }

    ctx.globalAlpha = opacity
    ctx.fillStyle = cursorColor
    if (style === "underline") {
      const thick = Math.max(1, Math.round(dpr * 2))
      ctx.fillRect(px, py + ph - thick, pw, thick)
      ctx.restore()
      return
    }
    if (style === "bar") {
      const thick = Math.max(1, Math.round(dpr * 2))
      ctx.fillRect(px, py, thick, ph)
      ctx.restore()
      return
    }
    ctx.fillRect(px, py, pw, ph)
    ctx.restore()
    if (wasmTerm && cell && opacity > 0.25) drawBlockGlyph(wasmTerm, cell, cellW, cellH, baseline, dpr, opacity)
  }

  const clearDirty = () => {
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (dirtyRect) {
      ctx.clearRect(dirtyRect.x, dirtyRect.y, dirtyRect.w, dirtyRect.h)
      dirtyRect = undefined
      return
    }
    ctx.clearRect(0, 0, overlay.width, overlay.height)
  }

  const render = () => {
    if (disposed || !ctx) return
    cancelTimers()
    const geo = syncGeometry()
    if (!geo) return
    clearDirty()
    if (paused || viewportY > 0 || !cursor.visible) return

    const now = performance.now()
    const sample = glide ? sampleCursorGlide(glide, now) : { x: cursor.x, y: cursor.y, stretchX: 0, active: false }
    if (glide && !sample.active) glide = { ...glide, fromX: glide.toX, fromY: glide.toY, active: false }

    const blink = sample.active
      ? { opacity: 1, animating: false, nextWakeMs: undefined }
      : computeBlinkState(now - lastActivityMs, {
          blinking,
          focused,
          idleStopMs: CURSOR_IDLE_STOP_MS,
          reducedMotion: prefersReducedMotion(),
        })

    paintShape(sample, geo, blink.opacity)

    if (sample.active || blink.animating) {
      rafId = requestAnimationFrame(render)
      return
    }
    if (blink.nextWakeMs !== undefined) {
      wakeTimer = setTimeout(() => {
        wakeTimer = undefined
        render()
      }, Math.max(16, Math.ceil(blink.nextWakeMs)))
    }
  }

  const notifyActivity = () => {
    lastActivityMs = performance.now()
    if (!paused && !disposed) render()
  }

  return {
    syncFrame(nextCursor, nextViewportY) {
      const moved = nextCursor.x !== cursor.x || nextCursor.y !== cursor.y
      const visChanged = nextCursor.visible !== cursor.visible
      const scrollChanged = nextViewportY !== viewportY
      cursor = nextCursor
      viewportY = nextViewportY

      if (moved) {
        const now = performance.now()
        lastActivityMs = now
        const altScreen = term.wasmTerm?.isAlternateScreen() ?? false
        const allowGlide = focused && !paused && nextViewportY === 0 && !altScreen && !prefersReducedMotion()
        glide = startCursorGlide(glide, nextCursor, now, allowGlide)
        render()
        return
      }
      if (visChanged || scrollChanged) render()
    },
    setFocused(next) {
      if (focused === next) return
      focused = next
      if (next) lastActivityMs = performance.now()
      else if (glide) glide = { ...glide, fromX: cursor.x, fromY: cursor.y, toX: cursor.x, toY: cursor.y, active: false }
      render()
    },
    setTheme(theme) {
      cursorColor = theme.cursor ?? "#d4d4d4"
      cursorAccent = theme.cursorAccent ?? theme.background ?? "#1e1e1e"
      render()
    },
    setStyle(nextStyle, nextBlink) {
      if (style === nextStyle && blinking === nextBlink) return
      style = nextStyle
      blinking = nextBlink
      lastActivityMs = performance.now()
      render()
    },
    notifyActivity,
    pause() {
      paused = true
      cancelTimers()
    },
    resume() {
      paused = false
      if (focused) lastActivityMs = performance.now()
      render()
    },
    dispose() {
      disposed = true
      cancelTimers()
      overlay.remove()
    },
  }
}
