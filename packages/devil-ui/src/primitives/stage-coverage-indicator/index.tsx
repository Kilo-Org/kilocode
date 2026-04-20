/**
 * StageCoverageIndicator — visual 7-stage capability coverage for team builder.
 *
 * DOM branch production-ready; terminal branch Phase 5 TODO stub.
 * See .planning/specs/04-team-builder-views-spec.md
 *
 * Architecture note: Stage names are inlined here (matching WorkflowStage z.enum values)
 * to avoid importing from @devilcode/cli which would create a turbo cyclic dependency.
 * The array is the single source of truth for ordering in this component; the canonical
 * enum definition lives in packages/opencode/src/devilcode/workflow/types.ts.
 */
import { For, Show, type JSX } from "solid-js"
import { useRenderTarget } from "../../context/render-target"

// WorkflowStage z.enum options — inlined to avoid cross-package Zod type conflicts.
// Order matches STAGE_CAPABILITY_REQUIREMENTS in packages/opencode/src/devilcode/team/capabilities.ts
const ALL_STAGES: string[] = ["plan", "challenge", "contract", "build", "review", "ship", "retro"]

export type StageCoverageIndicatorProps = {
  missingStages: string[]
  allStages?: string[]
  compact?: boolean
}

export function StageCoverageIndicator(props: StageCoverageIndicatorProps): JSX.Element {
  const target = useRenderTarget()
  const stages = () => props.allStages ?? ALL_STAGES
  const missing = () => new Set(props.missingStages)

  return (
    <Show when={target.kind === "dom"} fallback={<TerminalStub stages={stages()} missing={missing()} />}>
      <DomBranch stages={stages()} missing={missing()} compact={props.compact ?? false} />
    </Show>
  )
}

function DomBranch(props: {
  stages: string[]
  missing: Set<string>
  compact: boolean
}): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Team workflow stage coverage"
      data-component="stage-coverage-indicator"
      style={{
        display: "flex",
        "flex-wrap": "wrap",
        gap: props.compact ? "4px" : "8px",
        "align-items": "center",
      }}
    >
      <For each={props.stages}>
        {(stage) => {
          const isMissing = props.missing.has(stage)
          return (
            <span
              data-stage={stage}
              data-missing={isMissing ? "true" : "false"}
              aria-invalid={isMissing ? "true" : "false"}
              style={{
                display: "inline-flex",
                "align-items": "center",
                gap: "4px",
                padding: props.compact ? "2px 6px" : "4px 10px",
                "border-radius": "4px",
                "font-size": props.compact ? "11px" : "13px",
                background: isMissing ? "#5c1f1f" : "#1f4d2e",
                color: isMissing ? "#ffb3b3" : "#a3e8b9",
                border: `1px solid ${isMissing ? "#a33" : "#3a8a55"}`,
              }}
            >
              <span aria-hidden>{isMissing ? "❌" : "✓"}</span>
              <span>{stage}</span>
            </span>
          )
        }}
      </For>
    </div>
  )
}

// Phase 5 TODO: real OpenTUI terminal rendering.
// Phase 4 ships text-only stub following Phase 3 dual-branch convention.
function TerminalStub(props: {
  stages: string[]
  missing: Set<string>
}): JSX.Element {
  const text = () =>
    props.stages
      .map((stage) => `${props.missing.has(stage) ? "[X]" : "[v]"} ${stage}`)
      .join("  ")
  return <text>{text()}</text>
}
