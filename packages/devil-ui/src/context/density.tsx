/**
 * DensityProvider — provides a reactive density mode to the component subtree.
 *
 * Density controls whether UI elements render in "compact" or "expanded" layouts.
 * The context value is an Accessor<DensityContextValue> so consumers can react
 * to density changes without adding a new reactive layer.
 *
 * Pattern mirrors RenderTargetProvider: one provider near the root, consumers
 * call useDensity() from hooks/use-density.tsx.
 */
import { createContext, createSignal, type Accessor, type JSX } from "solid-js"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DensityMode = "compact" | "expanded"

export type DensityContextValue = {
  /** Current density mode. */
  density: DensityMode
  /** Toggle between compact and expanded (or set explicitly). */
  setDensity: (d: DensityMode) => void
  /** Convenience toggle — flips between compact and expanded. */
  toggle: () => void
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Context value is `Accessor<DensityContextValue> | null`.
 * null means no provider has been mounted in the tree.
 */
export const DensityContext = createContext<Accessor<DensityContextValue> | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export type DensityProviderProps = {
  /** Initial density mode. */
  initial: DensityMode
  /**
   * Optional persistence callback — called whenever density changes.
   * May return a Promise (awaited by callers that care about completion).
   */
  onPersist?: (d: DensityMode) => void | Promise<void>
  children: JSX.Element
}

/**
 * Wraps a subtree with density state.
 * All descendants can read density via `useDensity()` or `useDensityOptional()`.
 */
export function DensityProvider(props: DensityProviderProps): JSX.Element {
  const [density, setDensitySignal] = createSignal<DensityMode>(props.initial)

  const setDensity = (d: DensityMode): void => {
    setDensitySignal(d)
    props.onPersist?.(d)
  }

  const toggle = (): void => {
    const next: DensityMode = density() === "compact" ? "expanded" : "compact"
    setDensity(next)
  }

  const value: Accessor<DensityContextValue> = () => ({ density: density(), setDensity, toggle })

  return <DensityContext.Provider value={value}>{props.children}</DensityContext.Provider>
}
