import type { RGBA } from "@opentui/core"
import { Show } from "solid-js"
import type { PermissionProvenance } from "@/kilocode/permission/provenance"
import type { ToolState } from "@kilocode/sdk/v2"

/** `state.metadata` off any tool state, including the pending variant that lacks the field. */
export function stateMetadata(state: ToolState | undefined) {
  return state && "metadata" in state ? state.metadata : undefined
}

const SOURCES = ["agent", "global", "project", "yolo", "session", "manual", "default"] as const

/** Read the approval/denial provenance off a tool part's metadata, if present. */
export function toolApprovalFrom(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.approval
  if (!value || typeof value !== "object") return undefined
  const approval = value as PermissionProvenance.Approval
  return (SOURCES as readonly string[]).includes(approval.source) ? approval : undefined
}

function sourceLabel(approval: PermissionProvenance.Approval): string | undefined {
  switch (approval.source) {
    case "agent":
      return approval.agent ? `by the ${approval.agent} agent` : "by the agent"
    case "global":
      return "by your global config"
    case "project":
      return "by the project config"
    case "yolo":
      return "by auto-approve (YOLO) mode"
    case "session":
      return "by a session auto-approve rule"
    case "default":
      return "by default"
    default:
      return undefined
  }
}

/** A short "why" line describing an auto-approval or denial, for the TUI's plain-text rows. */
export function describeApproval(metadata: Record<string, unknown> | undefined): string | undefined {
  const approval = toolApprovalFrom(metadata)
  if (!approval) return undefined
  const manual = approval.source === "manual"
  const decision = manual ? "approved by you" : approval.rule?.action === "deny" ? "denied" : "auto-approved"
  if (manual) return decision
  const source = sourceLabel(approval)
  const rule = approval.rule
  // The catch-all "*"/"*" rule carries no useful detail; let the source alone explain it.
  const ruleText =
    rule && !(rule.permission === "*" && rule.pattern === "*") ? ` (matched ${rule.permission} \`${rule.pattern}\`)` : ""
  return source ? `${decision} ${source}${ruleText}` : decision
}

/**
 * The muted "why" annotation appended inline after a tool's title/summary text, matching the
 * `RoutedModelMeta.Badge` convention. Rendered on the header line (not after the tool's own
 * output) so it reads as metadata about the call rather than part of the output itself.
 */
export function ApprovalBadge(props: { note: string | undefined; color?: RGBA }) {
  return (
    <Show when={props.note}>
      <span style={{ fg: props.color }}> · {props.note}</span>
    </Show>
  )
}
