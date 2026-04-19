import { createFocusSignal, type RenderTargetAdapter } from "../context/render-target"

/**
 * Creates a `RenderTargetAdapter` backed by the OpenTUI terminal renderer.
 *
 * This is an **async factory** that uses a dynamic `import()` so that
 * `@opentui/core` is never statically bundled into DOM-only builds (VS Code
 * webview, web app). Callers that live in terminal-only code paths (e.g. the
 * TUI entry point) call this once at startup; DOM-only consumers never call
 * it, so tree-shaking / lazy chunking excludes `@opentui/*` entirely.
 *
 * Focus state is declarative (SolidJS signals) — primitives call
 * `setFocusedNodeId("palette-input")` on mount and read
 * `focusedNodeId() === "palette-input"` reactively. No imperative focus().
 */
export async function createTerminalAdapter(): Promise<RenderTargetAdapter> {
  // Dynamic import keeps @opentui/core out of DOM bundles that never call this.
  const core = await import("@opentui/core")

  const { focusedNodeId, setFocusedNodeId } = createFocusSignal()

  const measure = (text: string): { width: number; height: number } => {
    // Try the @opentui/core measureText export if available.
    // The exact export name may vary across minor versions — use a safe cast.
    const measureFn = (core as Record<string, unknown>)["measureText"] as
      | ((t: string) => { width: number; height: number })
      | undefined

    if (typeof measureFn === "function") {
      return measureFn(text)
    }

    // Fallback: character-count approximation suitable for monospace terminals.
    const lines = text.split("\n")
    const width = Math.max(...lines.map((l) => l.length))
    const height = lines.length
    return { width, height }
  }

  return {
    kind: "terminal",
    measure,
    focusedNodeId,
    setFocusedNodeId,
    // Terminal renderer uses plain-text inverse-color selection; rich HTML
    // highlighting (e.g. fuzzysort <b> tags) is not supported here.
    supportsRichHighlight: false,
  }
}
