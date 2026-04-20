/**
 * DensityToggle — button that cycles between "compact" and "expanded" density modes.
 *
 * DOM branch: accessible button with aria-pressed (string "true"|"false").
 * Terminal branch: stub text showing current density mode.
 *
 * Reads from useDensityOptional() (R1-08) so it works even without a DensityProvider.
 * When no provider is present, the toggle renders in a disabled/informational state.
 *
 * Lazy fallback form: fallback={() => <TerminalBranch/>} — cast required because
 * SolidJS 1.9.x types Show.fallback as JSX.Element (not () => JSX.Element).
 */
import { Show, type JSX } from "solid-js"
import { useRenderTarget } from "../../context/render-target"
import { useDensityOptional } from "../../hooks/use-density"
import type { DensityMode } from "../../context/density"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DensityToggleProps = {
  /** Fallback label for the compact mode button. Defaults to "Compact". */
  compactLabel?: string
  /** Fallback label for the expanded mode button. Defaults to "Expanded". */
  expandedLabel?: string
  /** Additional CSS class for the DOM branch wrapper. */
  class?: string
}

// ---------------------------------------------------------------------------
// Terminal branch — stub using <text> SVG/OpenTUI element
// ---------------------------------------------------------------------------

function TerminalBranch(props: { density: DensityMode | undefined }): JSX.Element {
  const label = () => (props.density === "compact" ? "[compact]" : "[expanded]")
  return <text>{label()}</text>
}

// ---------------------------------------------------------------------------
// DOM branch
// ---------------------------------------------------------------------------

function DomBranch(props: DensityToggleProps & { density: DensityMode | undefined; onToggle: () => void }): JSX.Element {
  const label = () => {
    if (props.density === "compact") return props.expandedLabel ?? "Expanded"
    return props.compactLabel ?? "Compact"
  }
  const isCompact = () => props.density === "compact"

  return (
    <button
      type="button"
      role="button"
      class={props.class}
      aria-pressed={isCompact() ? "true" : "false"}
      aria-label={`Switch to ${label()} density`}
      data-component="density-toggle"
      data-density={props.density ?? "expanded"}
      onClick={props.onToggle}
      style={{
        cursor: "pointer",
        padding: "4px 10px",
        "border-radius": "4px",
        border: "1px solid currentColor",
        background: "transparent",
        "font-size": "12px",
      }}
    >
      {label()}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Renders a toggle button for switching density mode.
 * Must be used inside a <DensityProvider> for toggle to have effect.
 * When no provider is present, renders in read-only/stub state.
 */
export function DensityToggle(props: DensityToggleProps): JSX.Element {
  const target = useRenderTarget()
  const densityCtx = useDensityOptional()

  const density = (): DensityMode | undefined => densityCtx?.()?.density
  const onToggle = (): void => {
    densityCtx?.()?.toggle()
  }

  // fallback cast: SolidJS 1.9.x types fallback as JSX.Element but lazy thunk is required by plan.
  return (
    <Show
      when={target.kind === "dom"}
      fallback={(() => <TerminalBranch density={density()} />) as unknown as JSX.Element}
    >
      <DomBranch {...props} density={density()} onToggle={onToggle} />
    </Show>
  )
}
