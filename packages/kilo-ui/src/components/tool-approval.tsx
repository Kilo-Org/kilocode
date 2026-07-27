import { createContext, useContext, Show, type Accessor, type ParentProps } from "solid-js"

/**
 * Explains why a tool call was auto-approved, inside the expanded tool row.
 *
 * The backend records this on the tool part's `state.metadata.approval`. The display strings are
 * resolved by the caller (which owns the localized `t`) and carried on the context, so this stays
 * free of any i18n key coupling.
 */
export type ToolApproval = {
  source: "agent" | "global" | "project" | "yolo" | "session" | "manual" | "default"
  agent?: string
  rule?: { permission: string; pattern: string; action: string }
}

/** Pre-resolved, localized text plus the raw approval, supplied by the caller. */
export type ToolApprovalDisplay = {
  approval: ToolApproval
  decision: string
  source?: string
  rule?: string
}

const SOURCE_KEYS = ["agent", "global", "project", "yolo", "session", "manual", "default"] as const

const Context = createContext<Accessor<ToolApprovalDisplay | undefined>>(() => undefined)

/** Provide the resolved approval to the tool row below. */
export function ToolApprovalProvider(props: ParentProps<{ value: Accessor<ToolApprovalDisplay | undefined> }>) {
  return <Context.Provider value={props.value}>{props.children}</Context.Provider>
}

export function useToolApproval() {
  return useContext(Context)
}

/** Read the raw approval payload off a tool part's metadata, if present. */
export function toolApprovalFrom(metadata: Record<string, unknown> | undefined): ToolApproval | undefined {
  const value = metadata?.approval
  if (!value || typeof value !== "object") return undefined
  const approval = value as ToolApproval
  return SOURCE_KEYS.includes(approval.source) ? approval : undefined
}

type Translate = (key: string, params?: Record<string, string | number | boolean>) => string

/** Resolve an approval read off metadata into localized display text via the caller's `t`. */
export function resolveToolApproval(
  metadata: Record<string, unknown> | undefined,
  t: Translate,
): ToolApprovalDisplay | undefined {
  const approval = toolApprovalFrom(metadata)
  if (!approval) return undefined
  const sourceText = () => {
    if (approval.source === "agent")
      return approval.agent
        ? t("ui.approval.source.agent", { agent: approval.agent })
        : t("ui.approval.source.agent.default")
    if (approval.source === "manual") return undefined
    return t(`ui.approval.source.${approval.source}`)
  }
  return {
    approval,
    decision: approval.source === "manual" ? t("ui.approval.manual") : t("ui.approval.auto"),
    source: sourceText(),
    rule: approval.rule
      ? t("ui.approval.rule", { permission: approval.rule.permission, pattern: approval.rule.pattern })
      : undefined,
  }
}

/** The single "why was this allowed" line shown inside a tool row's expanded body. */
export function ToolApprovalLine(props: { display: ToolApprovalDisplay }) {
  const manual = () => props.display.approval.source === "manual"
  return (
    <div data-slot="tool-approval-line" data-source={props.display.approval.source}>
      <span data-slot="tool-approval-decision">{props.display.decision}</span>
      <Show when={!manual()}>
        <Show when={props.display.source}>
          {(text) => <span data-slot="tool-approval-source">{text()}</span>}
        </Show>
        <Show when={props.display.rule}>{(text) => <span data-slot="tool-approval-rule">{text()}</span>}</Show>
      </Show>
    </div>
  )
}
