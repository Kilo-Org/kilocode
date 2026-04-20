/**
 * StagePositionBadge — shows which role covers a given workflow stage.
 *
 * DOM branch: rich badge with stage name and role label.
 * Terminal branch: compact ASCII text "[STAGE:Role]" — no emoji dependency.
 *
 * Lazy fallback form: fallback cast required because SolidJS 1.9.x types
 * Show.fallback as JSX.Element (not () => JSX.Element).
 */
import { Show, type JSX } from "solid-js"
import { useRenderTarget } from "../../context/render-target"
import type { StagePositionInfo } from "../../hooks/use-stage-position"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type StagePositionBadgeProps = {
  /** Derived stage position info — typically from useStagePosition(). */
  info: StagePositionInfo
  /** Compact layout — smaller padding and font. */
  compact?: boolean
  /** Additional CSS class for DOM branch. */
  class?: string
}

// ---------------------------------------------------------------------------
// Terminal branch — ASCII, no emoji dependency
// ---------------------------------------------------------------------------

function TerminalBranch(props: { info: StagePositionInfo }): JSX.Element {
  const text = () => {
    const { stage, position, roleLabel } = props.info
    if (!position) return `[${stage.toUpperCase()}:--]`
    const label = roleLabel ?? position
    // Compact ASCII — no emoji
    return `[${stage.toUpperCase()}:${label}]`
  }
  return <text>{text()}</text>
}

// ---------------------------------------------------------------------------
// DOM branch
// ---------------------------------------------------------------------------

function DomBranch(props: StagePositionBadgeProps): JSX.Element {
  const covered = () => !!props.info.position
  const roleDisplay = () => props.info.roleLabel ?? props.info.position ?? "--"

  return (
    <span
      data-component="stage-position-badge"
      data-stage={props.info.stage}
      data-covered={covered() ? "true" : "false"}
      class={props.class}
      aria-label={`Stage ${props.info.stage}: ${covered() ? `covered by ${roleDisplay()}` : "uncovered"}`}
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "4px",
        padding: props.compact ? "2px 6px" : "4px 10px",
        "border-radius": "4px",
        "font-size": props.compact ? "11px" : "12px",
        "font-family": "monospace",
        background: covered() ? "#1a3a2a" : "#3a1a1a",
        color: covered() ? "#7ee8a2" : "#e87e7e",
        border: `1px solid ${covered() ? "#3a7a5a" : "#7a3a3a"}`,
      }}
    >
      <span aria-hidden style={{ "font-weight": "bold", "text-transform": "uppercase", "font-size": "10px" }}>
        {props.info.stage}
      </span>
      <span aria-hidden>:</span>
      <span>{roleDisplay()}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

export function StagePositionBadge(props: StagePositionBadgeProps): JSX.Element {
  const target = useRenderTarget()

  // fallback cast: SolidJS 1.9.x types fallback as JSX.Element but lazy thunk is required by plan.
  return (
    <Show
      when={target.kind === "dom"}
      fallback={(() => <TerminalBranch info={props.info} />) as unknown as JSX.Element}
    >
      <DomBranch {...props} />
    </Show>
  )
}
