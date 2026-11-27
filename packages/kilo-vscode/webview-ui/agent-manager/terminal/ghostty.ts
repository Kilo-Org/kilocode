import {
  DirtyState,
  Ghostty,
  type FitAddon,
  type GhosttyCell,
  type GhosttyTerminal,
  type IRenderable,
  type SelectionCoordinates,
  type Terminal,
} from "ghostty-web"

type WindowWithWasm = {
  KILO_GHOSTTY_WASM_URI?: string
  KILO_SHIKI_WORKER_URI?: string
  __KILO_GHOSTTY_WASM_PROMISE?: Promise<WebAssembly.WebAssemblyInstantiatedSource | null>
}

/** Narrow runtime surface for ghostty-web internals that lack public methods. */
interface GhosttyRuntimeTerminal {
  cancelRenderLoop?: () => void
  startRenderLoop?: () => void
  handleMouseUp?: (event: MouseEvent) => void
  scrollbarOpacity?: number
  currentHoveredLink?: { text?: unknown }
  linkDetector?: { getLinkAt: (col: number, row: number) => Promise<{ text: string } | undefined> }
}

interface GhosttyRuntimeRenderer {
  renderScrollbar?: (viewportY: number, scrollbackLength: number, visibleRows: number, opacity?: number) => void
  cursorBlink?: boolean
  cursorVisible?: boolean
  hoveredHyperlinkId?: number
  hoveredLinkRange?: { startX: number; startY: number; endX: number; endY: number } | null
  selectionManager?: {
    hasSelection: () => boolean
    getSelectionCoords: () => SelectionCoordinates | null
    getDirtySelectionRows: () => Set<number>
  }
}

interface DirtyTrackableRenderable extends IRenderable {
  update?: () => DirtyState
  getScrollbackGraphemeString?: (offset: number, col: number) => string
}

interface RenderSnapshot {
  buffer: IRenderable
  viewportY: number
  scrollback: number
  scrollbarOpacity: number
  cursorX: number
  cursorY: number
  cursorVisible: boolean
  hoveredId: number
  hoveredRange: string
  selection: string
  cols: number
  rows: number
  dpr: number
}

export { measureFontCell, measureHostDimensions, measureInitialDimensions } from "./measure"

let shared: Promise<Ghostty> | undefined
let loaded: Ghostty | undefined

/** Resolve the bundled `ghostty-vt.wasm` URI inside VS Code webviews. */
export function resolveGhosttyWasmUrl(): string | undefined {
  if (typeof window === "undefined") return undefined
  const globals = window as unknown as WindowWithWasm
  if (globals.KILO_GHOSTTY_WASM_URI) return globals.KILO_GHOSTTY_WASM_URI
  return globals.KILO_SHIKI_WORKER_URI?.replace(/shiki-worker\.js$/, "ghostty-vt.wasm")
}

/** Return the already-loaded shared Ghostty instance synchronously for zero-delay hot starts. */
export function getLoadedGhostty(): Ghostty | undefined {
  return loaded
}

async function instantiateGhostty(wasmUrl: string | undefined): Promise<Ghostty> {
  if (typeof window !== "undefined") {
    const globals = window as unknown as WindowWithWasm
    const boot = globals.__KILO_GHOSTTY_WASM_PROMISE
    if (boot) {
      globals.__KILO_GHOSTTY_WASM_PROMISE = undefined
      const result = await boot
      if (result?.instance) return new Ghostty(result.instance)
    }
    if (wasmUrl && typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiateStreaming === "function") {
      try {
        const result = await WebAssembly.instantiateStreaming(fetch(wasmUrl), { env: { log: () => undefined } })
        return new Ghostty(result.instance)
      } catch {
        // Fall through to Ghostty.load() when streaming compilation is unavailable.
      }
    }
  }
  return Ghostty.load(wasmUrl)
}

/**
 * Load one shared libghostty WASM instance for every terminal in the webview.
 * Consumes the inline HTML streaming-compile promise when available for near-0ms
 * cold start, and caches the resolved instance for synchronous hot starts.
 */
export function loadGhostty(wasmUrl: string | undefined = resolveGhosttyWasmUrl()): Promise<Ghostty> {
  if (loaded) return Promise.resolve(loaded)
  if (!shared) {
    shared = instantiateGhostty(wasmUrl)
      .then((instance) => {
        loaded = instance
        return instance
      })
      .catch((error: unknown) => {
        shared = undefined
        throw error
      })
  }
  return shared
}

/** Warm the shared libghostty WASM module in the background before the first terminal opens. */
export function preloadGhostty(): void {
  void loadGhostty().catch(() => undefined)
}

/**
 * Fit the terminal directly without ghostty-web FitAddon's 50ms re-entrancy
 * lockout, enabling smooth 60fps resizing during inspector divider drags.
 * Returns true when dimensions changed.
 */
export function fitTerminalDirect(term: Terminal, fit: FitAddon): boolean {
  const dims = fit.proposeDimensions()
  if (!dims) return false
  if (dims.cols === term.cols && dims.rows === term.rows) return false
  term.resize(dims.cols, dims.rows)
  return true
}

function runtime(term: Terminal): GhosttyRuntimeTerminal {
  return term as unknown as GhosttyRuntimeTerminal
}

function selectionKey(manager: GhosttyRuntimeRenderer["selectionManager"]): string {
  if (!manager?.hasSelection()) return ""
  const coords = manager.getSelectionCoords()
  if (!coords) return ""
  return `${coords.startCol},${coords.startRow},${coords.endCol},${coords.endRow}`
}

function hoverRangeKey(range: GhosttyRuntimeRenderer["hoveredLinkRange"]): string {
  if (!range) return ""
  return `${range.startX},${range.startY},${range.endX},${range.endY}`
}

function isRendererFocused(canvas: HTMLCanvasElement | undefined): boolean {
  const parent = canvas?.parentElement
  if (!parent) return true
  if (typeof document === "undefined") return false
  return document.hasFocus() && parent.contains(document.activeElement)
}

function sameSnapshot(a: RenderSnapshot | undefined, b: RenderSnapshot): boolean {
  if (!a) return false
  return (
    a.buffer === b.buffer &&
    a.viewportY === b.viewportY &&
    (b.viewportY === 0 || a.scrollback === b.scrollback) &&
    a.scrollbarOpacity === b.scrollbarOpacity &&
    a.cursorX === b.cursorX &&
    a.cursorY === b.cursorY &&
    a.cursorVisible === b.cursorVisible &&
    a.hoveredId === b.hoveredId &&
    a.hoveredRange === b.hoveredRange &&
    a.selection === b.selection &&
    a.cols === b.cols &&
    a.rows === b.rows &&
    a.dpr === b.dpr
  )
}

function captureSnapshot(opts: {
  buffer: IRenderable
  internals: GhosttyRuntimeRenderer
  canvas: HTMLCanvasElement | undefined
  viewportY: number
  scrollback: number
  scrollbarOpacity: number
}): RenderSnapshot {
  const { buffer, internals, canvas, viewportY, scrollback, scrollbarOpacity } = opts
  const cursor = buffer.getCursor()
  const dims = buffer.getDimensions()
  const blinkVisible = !internals.cursorBlink || internals.cursorVisible !== false
  const cursorVisible = viewportY === 0 && cursor.visible && isRendererFocused(canvas) && blinkVisible
  return {
    buffer,
    viewportY,
    scrollback,
    scrollbarOpacity,
    cursorX: cursor.x,
    cursorY: cursor.y,
    cursorVisible,
    hoveredId: internals.hoveredHyperlinkId ?? 0,
    hoveredRange: hoverRangeKey(internals.hoveredLinkRange),
    selection: selectionKey(internals.selectionManager),
    cols: dims.cols,
    rows: dims.rows,
    dpr: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
  }
}

function wrapRenderBuffer(
  buffer: DirtyTrackableRenderable,
  viewportY: number,
  scrollback: number,
  hideCanvasCursor: boolean,
): IRenderable {
  const scrollGraphemes = viewportY > 0 && !!buffer.getScrollbackGraphemeString && !!buffer.getGraphemeString
  if (!scrollGraphemes && !hideCanvasCursor) return buffer
  const scrollbackGrapheme = scrollGraphemes ? buffer.getScrollbackGraphemeString!.bind(buffer) : undefined
  const screenGrapheme = buffer.getGraphemeString ? buffer.getGraphemeString.bind(buffer) : undefined
  return {
    getLine: (y) => buffer.getLine(y),
    getCursor: () => {
      const cursor = buffer.getCursor()
      return hideCanvasCursor ? { ...cursor, visible: false } : cursor
    },
    getDimensions: () => buffer.getDimensions(),
    isRowDirty: (y) => buffer.isRowDirty(y),
    needsFullRedraw: buffer.needsFullRedraw ? () => buffer.needsFullRedraw!() : undefined,
    clearDirty: () => buffer.clearDirty(),
    getGraphemeString: scrollGraphemes
      ? (row, col) =>
          row < viewportY
            ? scrollbackGrapheme!(scrollback - viewportY + row, col)
            : screenGrapheme!(row - viewportY, col)
      : screenGrapheme,
  }
}

function drawOverlayScrollbar(
  canvas: HTMLCanvasElement,
  viewportY: number,
  scrollbackLength: number,
  visibleRows: number,
  opacity: number,
): boolean {
  const ctx = canvas.getContext("2d")
  if (!ctx || canvas.width <= 0 || canvas.height <= 0) return false
  const cssW = Number.parseFloat(canvas.style.width) || canvas.width
  const dpr = Math.max(1, canvas.width / cssW)
  const barW = Math.max(1, Math.round(6 * dpr))
  const pad = Math.max(1, Math.round(3 * dpr))
  const trackH = canvas.height - pad * 2
  if (trackH <= 0) return true
  const totalRows = scrollbackLength + visibleRows
  const thumbH = Math.max(Math.round(20 * dpr), Math.round((visibleRows / totalRows) * trackH))
  const ratio = Math.min(1, Math.max(0, viewportY / scrollbackLength))
  const thumbY = pad + Math.round((trackH - thumbH) * (1 - ratio))
  const alpha = (viewportY > 0 ? 0.45 : 0.28) * opacity
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = `rgba(128, 128, 128, ${alpha})`
  ctx.fillRect(canvas.width - barW - Math.round(2 * dpr), thumbY, barW, thumbH)
  ctx.restore()
  return true
}

/**
 * Wrap `term.renderer.render` to eliminate four ghostty-web CanvasRenderer flaws:
 * 1. When `viewportY > 0` (user scrolled up), ghostty-web redraws every row at
 *    60fps even while idle (~21% CPU), and compares `y < viewportY` against
 *    fractional smooth-scroll values, duplicating one row at the boundary.
 * 2. When `cursorBlink` is enabled, ghostty-web redraws the cursor row at 60fps
 *    instead of only when cursor visibility toggles (~2Hz).
 * 3. When `viewportY > 0`, grapheme clusters (ZWJ emoji, flags, Devanagari,
 *    combining marks) read from screen row `y` instead of the scrollback row.
 * 4. `renderScrollbar` clears and fills an opaque 14px background strip inside
 *    the canvas right edge, erasing the last two columns of text whenever
 *    `scrollbarOpacity > 0` (including the default `1` on direct render calls).
 *
 * When `onCursorFrame` is supplied, CanvasRenderer's raw rectangle cursor is
 * suppressed and delegated to our dedicated animated cursor overlay.
 */
export function optimizeTerminalRenderer(
  term: Terminal,
  onCursorFrame?: (cursor: { x: number; y: number; visible: boolean }, viewportY: number) => void,
): void {
  const renderer = term.renderer
  if (!renderer) return
  const original = renderer.render.bind(renderer)
  const internals = renderer as unknown as GhosttyRuntimeRenderer
  const originalRenderScrollbar = internals.renderScrollbar?.bind(renderer)
  let last: RenderSnapshot | undefined

  // Draw only a translucent overlay scrollbar thumb via the public canvas API
  // without clearing/erasing the rightmost two text columns with an opaque fill.
  internals.renderScrollbar = (viewportY, scrollbackLength, visibleRows, opacity = 0) => {
    if (opacity <= 0 || scrollbackLength <= 0) return
    const canvas = renderer.getCanvas()
    if (!canvas || !drawOverlayScrollbar(canvas, viewportY, scrollbackLength, visibleRows, opacity)) {
      originalRenderScrollbar?.(viewportY, scrollbackLength, visibleRows, opacity)
    }
  }

  renderer.render = (buffer, forceAll = false, viewportY = 0, scrollbackProvider, scrollbarOpacity = 0) => {
    const intViewportY = Math.max(0, Math.floor(viewportY))
    const trackable = buffer as DirtyTrackableRenderable
    const dirty = trackable.update ? trackable.update() : DirtyState.FULL
    const scrollback = scrollbackProvider ? scrollbackProvider.getScrollbackLength() : 0
    // Collapse fade-in/fade-out opacity ramps into a clean binary visible state
    // so scrollbar timers do not force 18-30 full-canvas redraws while idle.
    const effectiveOpacity = scrollback > 0 && scrollbarOpacity > 0.05 ? 1 : 0
    const dirtySelection = (internals.selectionManager?.getDirtySelectionRows().size ?? 0) > 0
    const canvas = renderer.getCanvas()
    const next = captureSnapshot({
      buffer,
      internals,
      canvas,
      viewportY: intViewportY,
      scrollback,
      scrollbarOpacity: effectiveOpacity,
    })

    const unchanged =
      !forceAll && dirty === DirtyState.NONE && !dirtySelection && !buffer.needsFullRedraw?.() && sameSnapshot(last, next)
    if (unchanged) return

    const scrollbarChanged = last !== undefined && last.scrollbarOpacity !== next.scrollbarOpacity
    const cursor = buffer.getCursor()
    last = next
    const target = wrapRenderBuffer(trackable, intViewportY, scrollback, Boolean(onCursorFrame))
    original(target, forceAll || scrollbarChanged, intViewportY, scrollbackProvider, effectiveOpacity)
    onCursorFrame?.(cursor, intViewportY)
  }
}

/** Paint dirty rows immediately without waiting for the next animation frame. */
export function renderTerminalDirty(term: Terminal): void {
  if (!term.renderer || !term.wasmTerm) return
  term.renderer.render(
    term.wasmTerm,
    false,
    Math.max(0, Math.floor(term.viewportY)),
    term,
    runtime(term).scrollbarOpacity ?? 0,
  )
}

/** Force a full Canvas redraw from the current libghostty WASM screen state. */
export function redrawTerminal(term: Terminal): void {
  if (!term.renderer || !term.wasmTerm) return
  term.renderer.render(
    term.wasmTerm,
    true,
    Math.max(0, Math.floor(term.viewportY)),
    term,
    runtime(term).scrollbarOpacity ?? 0,
  )
}

/**
 * Pause a hidden terminal's 60fps render loop and cursor blink timer.
 * WASM parsing continues on incoming PTY bytes so the screen stays up to date
 * with zero rAF or Canvas overhead while the terminal is off-screen.
 */
export function pauseTerminalRender(term: Terminal): void {
  runtime(term).cancelRenderLoop?.()
  term.renderer?.setCursorBlink(false)
}

/** Resume a visible terminal's render loop, blink state, and paint a full frame. */
export function resumeTerminalRender(term: Terminal, blink: boolean): void {
  term.renderer?.setCursorBlink(blink)
  redrawTerminal(term)
  runtime(term).startRenderLoop?.()
}

/**
 * Dispose a ghostty-web Terminal and clean up its document mouseup listener.
 * ghostty-web sets `isOpen = false` before `cleanupComponents()` checks `if (this.isOpen)`,
 * which otherwise leaks a document `mouseup` listener per closed terminal.
 */
export function disposeTerminalSafely(term: Terminal): void {
  const handleMouseUp = runtime(term).handleMouseUp
  term.dispose()
  if (handleMouseUp && typeof document !== "undefined") {
    document.removeEventListener("mouseup", handleMouseUp)
  }
}

/** Read the currently hovered link URL from ghostty-web's link detector state. */
export function hoveredLinkText(term: Terminal): string | undefined {
  const text = runtime(term).currentHoveredLink?.text
  return typeof text === "string" && text.length > 0 ? text : undefined
}

/** Resolve the link URL at a mouse click, preferring the cached hovered link. */
export async function resolveLinkAtClick(term: Terminal, event: MouseEvent): Promise<string | undefined> {
  const hovered = hoveredLinkText(term)
  if (hovered) return hovered
  const detector = runtime(term).linkDetector
  const canvas = term.renderer?.getCanvas()
  if (!detector || !canvas || !term.renderer || !term.wasmTerm) return undefined
  const width = term.renderer.charWidth
  const height = term.renderer.charHeight
  if (width <= 0 || height <= 0) return undefined
  const rect = canvas.getBoundingClientRect()
  const col = Math.floor((event.clientX - rect.left) / width)
  const row = Math.floor((event.clientY - rect.top) / height)
  const scrollback = term.wasmTerm.getScrollbackLength()
  const viewportY = Math.max(0, Math.floor(term.getViewportY()))
  const bufferRow =
    viewportY > 0
      ? row < viewportY
        ? scrollback - viewportY + row
        : scrollback + (row - viewportY)
      : scrollback + row
  const link = await detector.getLinkAt(col, bufferRow)
  return link?.text
}

function formatCells(cells: GhosttyCell[] | null, grapheme: (col: number) => string): string {
  if (!cells) return ""
  let out = ""
  for (let col = 0; col < cells.length; col++) {
    const cell = cells[col]!
    if (cell.width === 0) continue
    if (cell.grapheme_len > 0) {
      out += grapheme(col)
      continue
    }
    const cp = cell.codepoint
    if (cp === 0) {
      out += " "
      continue
    }
    if (cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      out += "\uFFFD"
      continue
    }
    out += String.fromCodePoint(cp)
  }
  return out.trimEnd()
}

/** Read a GhosttyTerminal's active buffer (scrollback + screen), preserving full Unicode grapheme clusters. */
export function readWasmBuffer(wasmTerm: GhosttyTerminal): string {
  const lines: string[] = []
  if (!wasmTerm.isAlternateScreen()) {
    const scrollback = wasmTerm.getScrollbackLength()
    for (let row = 0; row < scrollback; row++) {
      lines.push(formatCells(wasmTerm.getScrollbackLine(row), (col) => wasmTerm.getScrollbackGraphemeString(row, col)))
    }
  }
  wasmTerm.update()
  const { rows } = wasmTerm.getDimensions()
  for (let row = 0; row < rows; row++) {
    lines.push(formatCells(wasmTerm.getLine(row), (col) => wasmTerm.getGraphemeString(row, col)))
  }
  return lines.join("\n")
}

/** Read the active terminal buffer (scrollback + viewport) as newline-separated plain text. */
export function readTerminalBuffer(term: Terminal): string {
  if (term.wasmTerm) return readWasmBuffer(term.wasmTerm)
  const buffer = term.buffer.active
  return Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? "").join(
    "\n",
  )
}
