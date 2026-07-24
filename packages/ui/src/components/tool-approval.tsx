// kilocode_change - new file
import { createContext, useContext, Show, type Accessor, type ParentProps } from "solid-js"
import { useI18n } from "../context/i18n"

/** Why a tool call was allowed, recorded on the tool part's metadata by the backend. */
export type ToolApproval = {
  source: "agent" | "global" | "project" | "yolo" | "manual" | "default"
  agent?: string
  rule?: { permission: string; pattern: string; action: string }
}

const SOURCE_KEYS = ["agent", "global", "project", "yolo", "manual", "default"] as const

const Context = createContext<Accessor<ToolApproval | undefined>>(() => undefined)

/** Provide the approval read off a tool part's metadata to the tool row below. */
export function ToolApprovalProvider(props: ParentProps<{ value: Accessor<ToolApproval | undefined> }>) {
  return <Context.Provider value={props.value}>{props.children}</Context.Provider>
}

export function useToolApproval() {
  return useContext(Context)
}

/** Read a raw metadata record and return the approval payload if present. */
export function toolApprovalFrom(metadata: Record<string, unknown> | undefined): ToolApproval | undefined {
  const value = metadata?.approval
  if (!value || typeof value !== "object") return undefined
  const approval = value as ToolApproval
  return SOURCE_KEYS.includes(approval.source) ? approval : undefined
}

/** The single "why was this allowed" line shown inside a tool row's expanded body. */
export function ToolApprovalLine(props: { approval: ToolApproval }) {
  const i18n = useI18n()
  const manual = () => props.approval.source === "manual"

  const sourceText = () => {
    switch (props.approval.source) {
      case "agent":
        return props.approval.agent
          ? i18n.t("ui.approval.source.agent", { agent: props.approval.agent })
          : i18n.t("ui.approval.source.agent.default")
      case "global":
        return i18n.t("ui.approval.source.global")
      case "project":
        return i18n.t("ui.approval.source.project")
      case "yolo":
        return i18n.t("ui.approval.source.yolo")
      default:
        return i18n.t("ui.approval.source.default")
    }
  }

  const ruleText = () => {
    const rule = props.approval.rule
    if (!rule) return undefined
    return i18n.t("ui.approval.rule", { permission: rule.permission, pattern: rule.pattern })
  }

  return (
    <div data-slot="tool-approval-line" data-source={props.approval.source}>
      <span data-slot="tool-approval-decision">{manual() ? i18n.t("ui.approval.manual") : i18n.t("ui.approval.auto")}</span>
      <Show when={!manual()}>
        <span data-slot="tool-approval-source">{sourceText()}</span>
        <Show when={ruleText()}>{(text) => <span data-slot="tool-approval-rule">{text()}</span>}</Show>
      </Show>
    </div>
  )
}
