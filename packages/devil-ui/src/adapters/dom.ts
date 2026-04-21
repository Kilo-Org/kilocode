import { createFocusSignal, type RenderTargetAdapter } from "../context/render-target"

// ─── Singleton canvas context ─────────────────────────────────────────────────

let _canvas: HTMLCanvasElement | null = null
let _ctx: CanvasRenderingContext2D | null = null

function getCanvasContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null
  if (!_canvas) {
    _canvas = document.createElement("canvas")
    _canvas.width = 1
    _canvas.height = 1
    _ctx = _canvas.getContext("2d")
  }
  return _ctx
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a `RenderTargetAdapter` for browser / DOM environments.
 *
 * Zero imports from `@opentui/*` — this adapter is safe to include in the
 * VS Code webview bundle, the web app, or Storybook under Node.js.
 *
 * Focus state is declarative (SolidJS signals). Primitives call
 * `setFocusedNodeId("palette-input")` on mount and read
 * `focusedNodeId() === "palette-input"` reactively.
 *
 * `measure()` uses a singleton hidden `<canvas>` for accurate text metrics
 * in browser environments, falling back to character-count estimation when
 * running under Node (e.g. Storybook SSR, unit tests).
 */
export function createDomAdapter(): RenderTargetAdapter {
  const { focusedNodeId, setFocusedNodeId } = createFocusSignal()

  const measure = (text: string): { width: number; height: number } => {
    const ctx = getCanvasContext()

    if (ctx) {
      const lines = text.split("\n")
      let maxWidth = 0
      for (const line of lines) {
        const metrics = ctx.measureText(line)
        if (metrics.width > maxWidth) maxWidth = metrics.width
      }
      // Approximate line height from font metrics when available; fall back to 16px.
      const lineHeight =
        "fontBoundingBoxAscent" in TextMetrics.prototype
          ? (ctx.measureText("M") as TextMetrics).fontBoundingBoxAscent +
            (ctx.measureText("M") as TextMetrics).fontBoundingBoxDescent
          : 16
      return { width: Math.ceil(maxWidth), height: lines.length * lineHeight }
    }

    // Non-browser fallback: 8px-per-char estimate used by Storybook / tests.
    const lines = text.split("\n")
    return {
      width: Math.max(...lines.map((l) => l.length)) * 8,
      height: lines.length * 16,
    }
  }

  return {
    kind: "dom",
    measure,
    focusedNodeId,
    setFocusedNodeId,
    // DOM supports <b>/<mark> wrapping from fuzzysort HTML results.
    supportsRichHighlight: true,
  }
}
