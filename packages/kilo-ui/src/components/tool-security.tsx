import { createContext, useContext, Show, type Accessor, type ParentProps } from "solid-js"
import { SecurityStatus } from "@opencode-ai/core/security-status"

/**
 * The deterministic security layer's state for one tool call, as a compact header badge.
 *
 * It sits beside the approval line rather than replacing it: approval answers "why was this
 * allowed", this answers "what is the security layer doing about it right now" — and unlike the
 * approval, one of its states (`reviewing`) is transient, so it has to be visible on the collapsed
 * header while the call is still pending, not only inside an expanded body.
 *
 * The badge carries the state and nothing else. `rule_id`, the reviewer's reason code and its
 * latency are detail: true, useful, and meaningless at a glance, so they live in the tooltip.
 */
export type SecurityDisplay = {
  status: SecurityStatus.Status
  /** Localized one- or two-word state, resolved by the caller that owns `t`. */
  label: string
  /** Machine-readable detail for the tooltip. Stable ids and numbers, so never translated. */
  detail: string
}

const Context = createContext<Accessor<SecurityDisplay | undefined>>(() => undefined)

export function ToolSecurityProvider(props: ParentProps<{ value: Accessor<SecurityDisplay | undefined> }>) {
  return <Context.Provider value={props.value}>{props.children}</Context.Provider>
}

export function useToolSecurity() {
  return useContext(Context)
}

type Translate = (key: string, params?: Record<string, string | number | boolean>) => string

const LABELS: Record<SecurityStatus.Kind, string> = {
  reviewing: "ui.security.reviewing",
  "auto-approved": "ui.security.autoApproved",
  "needs-approval": "ui.security.needsApproval",
  blocked: "ui.security.blocked",
}

/** Resolve the audit record on a tool part's metadata into localized display text. */
export function resolveSecurityStatus(
  metadata: Record<string, unknown> | undefined,
  t: Translate,
): SecurityDisplay | undefined {
  const status = SecurityStatus.from(metadata)
  if (!status) return undefined
  const detail = [
    status.rule_id,
    status.reason_code,
    status.latency_ms === undefined ? undefined : `${status.latency_ms}ms`,
  ].filter((part): part is string => part !== undefined)
  return { status, label: t(LABELS[status.kind]), detail: detail.join(" · ") }
}

/** The compact state chip shown on a tool row's header. */
export function ToolSecurityBadge(props: { display: SecurityDisplay }) {
  return (
    <Show when={props.display}>
      {(display) => (
        <span data-slot="tool-security-badge" data-kind={display().status.kind} title={display().detail || undefined}>
          {display().label}
        </span>
      )}
    </Show>
  )
}
