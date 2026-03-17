/**
 * PermissionDock component
 * Displays permission requests from the AI assistant in the dock above the prompt input.
 * Uses kilo-ui's DockPrompt component for proper surface styling.
 *
 * Per-rule toggles allow users to approve/deny individual permission rules for future requests.
 * For bash, the hierarchical rules from metadata.rules are shown.
 * For other tools, the always array is shown so users can configure per-tool permissions.
 * The command buttons (Deny / Allow Once) control the current command.
 * When all rules are toggled ✓, the command auto-runs.
 */

import { Component, For, Show, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { DockPrompt } from "@kilocode/kilo-ui/dock-prompt"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { PermissionRequest } from "../../types/messages"

type RuleDecision = "approved" | "denied" | "pending"

let rulesExpandedPreference = false

export const PermissionDock: Component<{
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "reject", approvedAlways: string[], deniedAlways: string[]) => void
}> = (props) => {
  const session = useSession()
  const language = useLanguage()

  const fromChild = () => props.request.sessionID !== session.currentSessionID()
  // Bash sends fine-grained rules via metadata.rules; other tools use the always array.
  const rules = () => props.request.args?.rules ?? props.request.always ?? []
  // Rules like "git *" or "git log *" — strip the trailing wildcard for display.
  // A bare "*" (global wildcard) becomes empty so only the tool name shows.
  const label = (rule: string) => (rule === "*" ? "" : rule.replace(/ \*$/, ""))
  const command = () => {
    const cmd = props.request.args?.command
    return typeof cmd === "string" ? cmd : undefined
  }

  const [decisions, setDecisions] = createSignal<Record<number, RuleDecision>>({})
  const [expanded, setExpanded] = createSignal(rulesExpandedPreference)

  const hasRules = () => rules().length > 0

  const toggleExpanded = () => {
    const next = !expanded()
    rulesExpandedPreference = next
    setExpanded(next)
  }

  const collectRules = () => {
    const all = rules()
    const approved: string[] = []
    const denied: string[] = []
    for (const [i, d] of Object.entries(decisions())) {
      const rule = all[Number(i)]
      if (!rule) continue
      if (d === "approved") approved.push(rule)
      else if (d === "denied") denied.push(rule)
    }
    return { approved, denied }
  }

  const toggleRule = (index: number, decision: RuleDecision) => {
    const current = decisions()[index]
    const next = current === decision ? "pending" : decision
    const updated = { ...decisions(), [index]: next }
    setDecisions(updated)

    const total = rules().length
    const count = Object.values(updated).filter((d) => d === "approved").length
    if (count === total && total > 0) {
      props.onDecide("once", [...rules()], [])
    }
  }

  const decision = (index: number): RuleDecision => decisions()[index] ?? "pending"

  const approveTooltip = (index: number) =>
    decision(index) === "approved"
      ? language.t("ui.permission.rule.removeFromAllowed")
      : language.t("ui.permission.rule.addToAllowed")

  const denyTooltip = (index: number) =>
    decision(index) === "denied"
      ? language.t("ui.permission.rule.removeFromDenied")
      : language.t("ui.permission.rule.addToDenied")

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.toolName}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  const subtitle = () => (fromChild() ? `${props.request.toolName} (subagent)` : props.request.toolName)

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="small" />
          </span>
          <div data-slot="permission-header-title">
            {language.t("notification.permission.title")}
            <span data-slot="permission-header-subtitle">{subtitle()}</span>
          </div>
        </div>
      }
      footer={
        <Show when={hasRules()}>
          <div data-slot="permission-rules-section">
            <button
              type="button"
              data-slot="permission-rules-header"
              data-open={expanded() ? "" : undefined}
              onClick={toggleExpanded}
              aria-expanded={expanded()}
            >
              <span data-slot="permission-rules-header-chevron" data-open={expanded() ? "" : undefined}>
                <Icon name="chevron-down" size="small" />
              </span>
              <span data-slot="permission-rules-header-title">{language.t("ui.permission.permissionRules")}</span>
            </button>

            <div data-slot="permission-rules-collapse" data-open={expanded() ? "" : undefined}>
              <div data-slot="permission-rules-collapse-inner">
                <div data-slot="permission-rules">
                  <For each={rules()}>
                    {(rule, index) => (
                      <div data-slot="permission-rule-row" data-decision={decision(index())}>
                        <div data-slot="permission-rule-actions">
                          <Tooltip value={approveTooltip(index())} placement="top">
                            <button
                              data-slot="permission-rule-toggle"
                              data-variant="approve"
                              data-active={decision(index()) === "approved" ? "" : undefined}
                              disabled={props.responding}
                              onClick={() => toggleRule(index(), "approved")}
                              aria-label={approveTooltip(index())}
                            >
                              <Icon name="check-small" size="small" />
                            </button>
                          </Tooltip>
                          <Tooltip value={denyTooltip(index())} placement="top">
                            <button
                              data-slot="permission-rule-toggle"
                              data-variant="deny"
                              data-active={decision(index()) === "denied" ? "" : undefined}
                              disabled={props.responding}
                              onClick={() => toggleRule(index(), "denied")}
                              aria-label={denyTooltip(index())}
                            >
                              <Icon name="close-small" size="small" />
                            </button>
                          </Tooltip>
                        </div>
                        <span data-slot="permission-rule-type">{props.request.toolName}</span>
                        <code data-slot="permission-rule">{label(rule)}</code>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </div>
        </Show>
      }
    >
      <Show when={command()}>{(cmd) => <code data-slot="permission-command">{cmd()}</code>}</Show>

      <Show when={!command() && toolDescription()}>
        <div data-slot="permission-hint">{toolDescription()}</div>
      </Show>

      <div data-slot="permission-actions">
        <Button
          variant="primary"
          size="small"
          onClick={() => {
            const { approved, denied } = collectRules()
            props.onDecide("once", approved, denied)
          }}
          disabled={props.responding}
        >
          {language.t("ui.permission.allowOnce")}
        </Button>
        <Button
          variant="ghost"
          size="small"
          onClick={() => {
            const { approved, denied } = collectRules()
            props.onDecide("reject", approved, denied)
          }}
          disabled={props.responding}
        >
          {language.t("ui.permission.deny")}
        </Button>
      </div>
    </DockPrompt>
  )
}
