/** @jsxImportSource solid-js */
import { For, Show, type JSX } from "solid-js"
import { useRenderTarget, RenderSurface } from "../context/render-target"

// ─── Types ────────────────────────────────────────────────────────────────────

// Inline EffortLevel values to avoid a cross-package import on @devilcode/cli
// (not listed in devil-ui's package.json dependencies).
const EFFORT_LEVELS = ["max", "xhigh", "high", "medium", "low", "default"] as const
type EffortLevel = (typeof EFFORT_LEVELS)[number]

/**
 * A single role entry in the roster, matching CanonicalTeamRole from
 * packages/opencode/src/devilcode/team/config.ts.
 */
export type RosterRole = {
  displayName: string
  positionId: string
  provider: string
  model: string
  effort: EffortLevel | string
  tier: number
  canDelegate: string[]
  maxConcurrent: number
  capabilities: string[]
  supplementaryCapabilities: string[]
}

/** ZodIssue-compatible error shape (Zod v3/v4 compatible). */
export type RosterError = {
  code: string
  message: string
  path: (string | number)[]
}

export type RosterTableProps = {
  roles: Record<string, RosterRole>
  errorsByRole: Record<string, RosterError[]>
  onEdit(positionId: string, field: string, value: unknown): void
  onDelete(positionId: string): void
  onAdd(): void
  selectedRole?: string | null
  onSelectRole?(positionId: string): void
}

// ─── DOM Branch ───────────────────────────────────────────────────────────────

function DomRosterTable(props: RosterTableProps): JSX.Element {
  return (
    <div
      class="roster-table-container"
      style={{
        "overflow-x": "auto",
        width: "100%",
      }}
    >
      <table
        class="roster-table"
        style={{
          width: "100%",
          "border-collapse": "collapse",
          "font-size": "13px",
          color: "var(--color-text, #cdd6f4)",
        }}
      >
        <thead>
          <tr
            style={{
              background: "var(--color-surface-overlay, #181825)",
              "border-bottom": "1px solid var(--color-border, #444)",
            }}
          >
            <th style={{ padding: "8px 12px", "text-align": "left", "font-weight": "600" }}>
              Position
            </th>
            <th style={{ padding: "8px 12px", "text-align": "left", "font-weight": "600" }}>
              Provider
            </th>
            <th style={{ padding: "8px 12px", "text-align": "left", "font-weight": "600" }}>
              Model
            </th>
            <th style={{ padding: "8px 12px", "text-align": "left", "font-weight": "600" }}>
              Effort
            </th>
            <th style={{ padding: "8px 12px", "text-align": "left", "font-weight": "600" }}>
              Delegates-to
            </th>
            <th style={{ padding: "8px 12px", "text-align": "left", "font-weight": "600" }}>
              Capabilities
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={Object.entries(props.roles)}>
            {([positionId, role]) => {
              const errors = () => props.errorsByRole[positionId] ?? []
              const hasErrors = () => errors().length > 0
              const isSelected = () => props.selectedRole === positionId

              return (
                <tr
                  data-position={positionId}
                  data-has-errors={hasErrors() ? "true" : "false"}
                  data-selected={isSelected() ? "true" : undefined}
                  title={hasErrors() ? errors().map((e) => e.message).join("\n") : undefined}
                  onClick={() => props.onSelectRole?.(positionId)}
                  style={{
                    background: hasErrors()
                      ? "#3a1a1a"
                      : isSelected()
                        ? "var(--color-selection, rgba(137,180,250,0.08))"
                        : "transparent",
                    border: hasErrors()
                      ? "1px solid #a33"
                      : isSelected()
                        ? "1px solid var(--color-accent, rgba(137,180,250,0.4))"
                        : "none",
                    "border-left": isSelected() ? "3px solid var(--color-accent, #89b4fa)" : undefined,
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                >
                  {/* Position column */}
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ "font-weight": "500" }}>{role.displayName}</div>
                    <div
                      style={{
                        "font-size": "11px",
                        color: "var(--color-subtext, #a6adc8)",
                        "font-family": "monospace",
                      }}
                    >
                      {positionId}
                    </div>
                  </td>

                  {/* Provider column */}
                  <td style={{ padding: "8px 12px" }}>
                    <input
                      type="text"
                      value={role.provider}
                      onInput={(e) => props.onEdit(positionId, "provider", e.currentTarget.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: "var(--color-input-bg, rgba(255,255,255,0.05))",
                        border: "1px solid var(--color-border, #444)",
                        "border-radius": "4px",
                        color: "var(--color-text, #cdd6f4)",
                        padding: "4px 8px",
                        "font-size": "12px",
                        width: "100%",
                        "min-width": "80px",
                      }}
                    />
                  </td>

                  {/* Model column */}
                  <td style={{ padding: "8px 12px" }}>
                    <input
                      type="text"
                      value={role.model}
                      onInput={(e) => props.onEdit(positionId, "model", e.currentTarget.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: "var(--color-input-bg, rgba(255,255,255,0.05))",
                        border: "1px solid var(--color-border, #444)",
                        "border-radius": "4px",
                        color: "var(--color-text, #cdd6f4)",
                        padding: "4px 8px",
                        "font-size": "12px",
                        width: "100%",
                        "min-width": "120px",
                      }}
                    />
                  </td>

                  {/* Effort column */}
                  <td style={{ padding: "8px 12px" }}>
                    <select
                      value={role.effort as string}
                      onChange={(e) => props.onEdit(positionId, "effort", e.currentTarget.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: "var(--color-input-bg, rgba(255,255,255,0.05))",
                        border: "1px solid var(--color-border, #444)",
                        "border-radius": "4px",
                        color: "var(--color-text, #cdd6f4)",
                        padding: "4px 8px",
                        "font-size": "12px",
                      }}
                    >
                      <For each={EFFORT_LEVELS}>
                        {(level) => (
                          <option value={level} selected={role.effort === level}>
                            {level}
                          </option>
                        )}
                      </For>
                    </select>
                  </td>

                  {/* Delegates-to column */}
                  <td style={{ padding: "8px 12px" }}>
                    <input
                      type="text"
                      value={role.canDelegate.join(", ")}
                      onInput={(e) => {
                        const raw = e.currentTarget.value
                        const parsed = raw
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)
                        props.onEdit(positionId, "canDelegate", parsed)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="comma-separated positions"
                      style={{
                        background: "var(--color-input-bg, rgba(255,255,255,0.05))",
                        border: "1px solid var(--color-border, #444)",
                        "border-radius": "4px",
                        color: "var(--color-text, #cdd6f4)",
                        padding: "4px 8px",
                        "font-size": "12px",
                        width: "100%",
                        "min-width": "120px",
                      }}
                    />
                  </td>

                  {/* Capabilities column — non-editable chips (Phase 4) */}
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
                      <For each={role.capabilities}>
                        {(cap) => (
                          <span
                            title="Capabilities are read-only in Phase 4"
                            style={{
                              display: "inline-block",
                              background: "var(--color-chip-bg, rgba(137,180,250,0.1))",
                              border: "1px solid var(--color-chip-border, rgba(137,180,250,0.3))",
                              "border-radius": "3px",
                              padding: "2px 6px",
                              "font-size": "11px",
                              color: "var(--color-subtext, #a6adc8)",
                              cursor: "not-allowed",
                            }}
                          >
                            {cap}
                          </span>
                        )}
                      </For>
                    </div>
                  </td>

                  {/* Delete button — not counted as a column */}
                  <td style={{ padding: "8px 4px" }}>
                    <button
                      data-action="delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onDelete(positionId)
                      }}
                      title={`Remove ${role.displayName}`}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--color-border, #444)",
                        "border-radius": "4px",
                        color: "var(--color-subtext, #a6adc8)",
                        cursor: "pointer",
                        padding: "2px 6px",
                        "font-size": "14px",
                        "line-height": "1",
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              )
            }}
          </For>
          <Show when={Object.keys(props.roles).length === 0}>
            <tr>
              <td
                colSpan={7}
                style={{
                  padding: "24px",
                  "text-align": "center",
                  color: "var(--color-subtext, #a6adc8)",
                  "font-style": "italic",
                }}
              >
                No positions configured. Click "+ Add Position" to get started.
              </td>
            </tr>
          </Show>
        </tbody>
      </table>
      <div style={{ padding: "8px 12px" }}>
        <button
          data-action="add"
          onClick={() => props.onAdd()}
          style={{
            background: "var(--color-accent-subtle, rgba(137,180,250,0.1))",
            border: "1px solid var(--color-accent, rgba(137,180,250,0.4))",
            "border-radius": "4px",
            color: "var(--color-accent-text, #89b4fa)",
            cursor: "pointer",
            padding: "6px 14px",
            "font-size": "13px",
          }}
        >
          + Add Position
        </button>
      </div>
    </div>
  )
}

// ─── Terminal Stub ────────────────────────────────────────────────────────────

function TerminalStub(props: { roles: Record<string, RosterRole> }): JSX.Element {
  // Phase 5 TODO: real OpenTUI table
  const summary = () =>
    Object.entries(props.roles)
      .map(([id, r]) => `${id}: ${r.provider}/${r.model} [${r.effort}]`)
      .join("\n")
  return <text>{summary()}</text>
}

// ─── RosterTable ──────────────────────────────────────────────────────────────

/**
 * 6-column editable team roster table.
 * DOM branch: full interactive table with inline inputs.
 * Terminal branch: Phase 5 stub — summary text only.
 *
 * Columns (in order): Position | Provider | Model | Effort | Delegates-to | Capabilities
 */
export function RosterTable(props: RosterTableProps): JSX.Element {
  const adapter = useRenderTarget()
  const domBranch = <DomRosterTable {...props} />
  const terminalBranch = <TerminalStub roles={props.roles} />
  return <RenderSurface kind={adapter.kind} terminal={terminalBranch} dom={domBranch} />
}
