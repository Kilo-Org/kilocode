import { createContext, useContext, createSignal, type Accessor, type JSX } from "solid-js"

// ─── Types ────────────────────────────────────────────────────────────────────

export type RenderTargetKind = "terminal" | "dom"

/**
 * Contract that both terminal and DOM adapters must satisfy.
 * Focused-node state is declarative (signals), not imperative,
 * so the adapter can work under the SolidJS reactive graph without
 * needing access to the DOM or TTY at creation time.
 */
export interface RenderTargetAdapter {
  kind: RenderTargetKind
  measure(text: string): { width: number; height: number }
  focusedNodeId: Accessor<string | null>
  setFocusedNodeId(id: string | null): void
  supportsRichHighlight: boolean
}

// ─── Focus signal factory ─────────────────────────────────────────────────────

/**
 * Creates the focused-node signal pair used by both adapters.
 * Call this inside adapter factory functions so each adapter instance
 * gets its own independent signal.
 */
export function createFocusSignal(): {
  focusedNodeId: Accessor<string | null>
  setFocusedNodeId: (id: string | null) => void
} {
  const [focusedNodeId, setFocusedNodeId] = createSignal<string | null>(null)
  return { focusedNodeId, setFocusedNodeId }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const RenderTargetContext = createContext<RenderTargetAdapter | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface RenderTargetProviderProps {
  adapter: RenderTargetAdapter
  children: JSX.Element
}

/**
 * Wraps a subtree with a specific render-target adapter.
 * Mount one `<RenderTargetProvider>` near the top of your app tree,
 * supplying either `createTerminalAdapter()` or `createDomAdapter()`.
 */
export function RenderTargetProvider(props: RenderTargetProviderProps): JSX.Element {
  return <RenderTargetContext.Provider value={props.adapter}>{props.children}</RenderTargetContext.Provider>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the nearest `RenderTargetAdapter`.
 * Throws if called outside a `<RenderTargetProvider>`.
 */
export function useRenderTarget(): RenderTargetAdapter {
  const ctx = useContext(RenderTargetContext)
  if (!ctx) {
    throw new Error("useRenderTarget must be called inside a <RenderTargetProvider>")
  }
  return ctx
}

// ─── RenderSurface helper ─────────────────────────────────────────────────────

export interface RenderSurfaceProps {
  kind: RenderTargetKind
  terminal: JSX.Element
  dom: JSX.Element
}

/**
 * Renders the appropriate branch based on the given `kind` prop.
 * This is a pure branch helper — it does NOT import `@opentui/*`.
 *
 * Note: Named `RenderSurface` (not `Surface`) to avoid shadowing any
 * identically-named symbol that might be re-exported upstream via
 * `export * from "@opencode-ai/ui/context"`.
 */
export function RenderSurface(props: RenderSurfaceProps): JSX.Element {
  return <>{props.kind === "terminal" ? props.terminal : props.dom}</>
}
