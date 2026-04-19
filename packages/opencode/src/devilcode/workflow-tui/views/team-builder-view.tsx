/** @jsxImportSource solid-js */
// packages/opencode/src/devilcode/workflow-tui/views/team-builder-view.tsx
import { Show, type JSX } from "solid-js"
import { RosterTable, type RosterTableProps } from "@devilcode/kilo-ui/components"
import { PositionPicker } from "@devilcode/kilo-ui/components"
import { StageCoverageIndicator } from "@devilcode/kilo-ui/primitives"
import { useTeamValidation } from "@devilcode/kilo-ui/hooks"
import { useTeamBuilder } from "./team-builder-context"
import { QuickstartLoader } from "./quickstart-loader"
import { useWorkflow } from "../context"

export function TeamBuilderView(): JSX.Element {
  const builder = useTeamBuilder()
  const workflow = useWorkflow()

  // Reactive validation derived from draft
  const validation = useTeamValidation(() => builder.draft)

  const roles = (): RosterTableProps["roles"] =>
    (builder.draft.roles ?? {}) as RosterTableProps["roles"]

  return (
    <div
      data-component="team-builder-view"
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "12px",
        padding: "16px",
        "overflow-y": "auto",
        height: "100%",
        color: "var(--color-text, #cdd6f4)",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
        <span style={{ "font-size": "16px", "font-weight": "700" }}>Team Builder</span>
        <Show when={builder.loadedQuickstart}>
          <span
            style={{
              "font-size": "11px",
              background: "rgba(137,180,250,0.1)",
              border: "1px solid rgba(137,180,250,0.3)",
              "border-radius": "3px",
              padding: "2px 6px",
              color: "#89b4fa",
            }}
          >
            {builder.loadedQuickstart}
          </span>
        </Show>
      </div>

      {/* Team ID row */}
      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
        <label
          for="team-id-input"
          style={{ "font-size": "13px", "min-width": "60px" }}
        >
          Team ID:
        </label>
        <input
          id="team-id-input"
          type="text"
          value={builder.teamId}
          onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
            builder.setTeamId(e.currentTarget.value)
          }
          style={{
            background: "var(--color-input-bg, rgba(255,255,255,0.05))",
            border: "1px solid var(--color-border, #444)",
            "border-radius": "4px",
            color: "var(--color-text, #cdd6f4)",
            padding: "4px 10px",
            "font-size": "13px",
            width: "200px",
          }}
        />
      </div>

      {/* Stage coverage indicator */}
      <div>
        <div style={{ "font-size": "12px", color: "var(--color-subtext, #a6adc8)", "margin-bottom": "6px" }}>
          Stage Coverage:
        </div>
        <StageCoverageIndicator missingStages={validation().missingStages} compact />
      </div>

      {/* Roster table */}
      <RosterTable
        roles={roles()}
        errorsByRole={validation().errorsByRole}
        onEdit={(positionId, field, value) => builder.editRole(positionId, field, value)}
        onDelete={(positionId) => builder.removeRole(positionId)}
        onAdd={() => builder.openPicker()}
        selectedRole={builder.selectedRole}
        onSelectRole={(positionId) => {
          builder.editRole(positionId, "_selected", true)
        }}
      />

      {/* Save status */}
      <Show when={builder.saveError}>
        <div
          style={{
            "font-size": "12px",
            color: "#ffb3b3",
            background: "#3a1a1a",
            border: "1px solid #a33",
            "border-radius": "4px",
            padding: "6px 10px",
          }}
        >
          {builder.saveError}
        </div>
      </Show>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
        <button
          data-action="load-quickstart"
          onClick={() => builder.openQuickstart()}
          style={{
            background: "transparent",
            border: "1px solid var(--color-border, #444)",
            "border-radius": "4px",
            color: "var(--color-subtext, #a6adc8)",
            cursor: "pointer",
            padding: "6px 12px",
            "font-size": "13px",
          }}
        >
          Load Quickstart
        </button>

        <button
          data-action="save"
          onClick={() => void builder.save()}
          disabled={builder.saveStatus === "saving"}
          style={{
            background: "rgba(137,180,250,0.1)",
            border: "1px solid rgba(137,180,250,0.4)",
            "border-radius": "4px",
            color: "#89b4fa",
            cursor: "pointer",
            padding: "6px 12px",
            "font-size": "13px",
          }}
        >
          {builder.saveStatus === "saving" ? "Saving..." : builder.saveStatus === "saved" ? "Saved" : "Save"}
        </button>

        <button
          data-action="start-build"
          disabled={!validation().isValid}
          onClick={() => void builder.validateAndStartBuild((config) => workflow.startBuild(config))}
          style={{
            background: validation().isValid ? "rgba(58,138,85,0.15)" : "transparent",
            border: `1px solid ${validation().isValid ? "#3a8a55" : "var(--color-border, #444)"}`,
            "border-radius": "4px",
            color: validation().isValid ? "#a3e8b9" : "var(--color-subtext, #a6adc8)",
            cursor: validation().isValid ? "pointer" : "not-allowed",
            padding: "6px 12px",
            "font-size": "13px",
          }}
        >
          Start Workflow
        </button>
      </div>

      {/* Position picker overlay */}
      <PositionPicker
        open={builder.pickerOpen}
        excludeIds={Object.keys(builder.draft.roles ?? {})}
        onSelect={(positionId) => {
          builder.addRole(positionId)
          builder.closePicker()
        }}
        onClose={() => builder.closePicker()}
      />

      {/* Quickstart loader overlay */}
      <QuickstartLoader open={builder.quickstartOpen} onClose={() => builder.closeQuickstart()} />
    </div>
  )
}
