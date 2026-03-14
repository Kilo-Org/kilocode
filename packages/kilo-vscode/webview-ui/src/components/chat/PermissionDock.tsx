/**
 * PermissionDock component
 * Displays permission requests from the AI assistant in the dock above the prompt input.
 * Uses kilo-ui's DockPrompt component for proper surface styling.
 *
 * Per-pattern toggles allow users to approve/deny individual patterns for future requests.
 * The command buttons (Deny / Allow Always / Allow Once) control the current command.
 * When all patterns are toggled ✓, the command auto-runs.
 */

import { Component, For, Show, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { DockPrompt } from "@kilocode/kilo-ui/dock-prompt"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { PermissionRequest } from "../../types/messages"

type PatternDecision = "approved" | "denied" | "pending"

let permissionPatternsExpandedPreference = false

export const PermissionDock: Component<{
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject", approvedPatterns: string[], deniedPatterns: string[]) => void
}> = (props) => {
  const session = useSession()
  const language = useLanguage()

  const fromChild = () => props.request.sessionID !== session.currentSessionID()
  const patterns = () => props.request.patterns ?? []
  const command = () => {
    const cmd = props.request.args?.command
    return typeof cmd === "string" ? cmd : undefined
  }

  const [decisions, setDecisions] = createSignal<Record<number, PatternDecision>>({})
  const [patternsExpanded, setPatternsExpanded] = createSignal(permissionPatternsExpandedPreference)

  const hasDeniedPatterns = () => Object.values(decisions()).some((d) => d === "denied")
  const hasPatterns = () => patterns().length > 0

  const togglePatternsExpanded = () => {
    const next = !patternsExpanded()
    permissionPatternsExpandedPreference = next
    setPatternsExpanded(next)
  }

  const collectPatterns = () => {
    const all = patterns()
    const approved: string[] = []
    const denied: string[] = []
    for (const [i, d] of Object.entries(decisions())) {
      const pattern = all[Number(i)]
      if (!pattern) continue
      if (d === "approved") approved.push(pattern)
      else if (d === "denied") denied.push(pattern)
    }
    return { approved, denied }
  }

  const togglePattern = (index: number, decision: PatternDecision) => {
    const current = decisions()[index]
    const next = current === decision ? "pending" : decision
    const updated = { ...decisions(), [index]: next }
    setDecisions(updated)

    const total = patterns().length
    const count = Object.values(updated).filter((d) => d === "approved").length
    if (count === total && total > 0) {
      props.onDecide("once", [...patterns()], [])
    }
  }

  const decision = (index: number): PatternDecision => decisions()[index] ?? "pending"

  const approveTooltip = (index: number) =>
    decision(index) === "approved"
      ? language.t("ui.permission.pattern.removeFromAllowed")
      : language.t("ui.permission.pattern.addToAllowed")

  const denyTooltip = (index: number) =>
    decision(index) === "denied"
      ? language.t("ui.permission.pattern.removeFromDenied")
      : language.t("ui.permission.pattern.addToDenied")

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
        <Show when={hasPatterns()}>
          <div data-slot="permission-patterns-section">
            <button
              type="button"
              data-slot="permission-patterns-header"
              data-open={patternsExpanded() ? "" : undefined}
              onClick={togglePatternsExpanded}
              aria-expanded={patternsExpanded()}
            >
              <span data-slot="permission-patterns-header-chevron" data-open={patternsExpanded() ? "" : undefined}>
                <Icon name="chevron-down" size="small" />
              </span>
              <span data-slot="permission-patterns-header-title">{language.t("ui.permission.permissionRules")}</span>
            </button>

            <div data-slot="permission-patterns-collapse" data-open={patternsExpanded() ? "" : undefined}>
              <div data-slot="permission-patterns-collapse-inner">
                <div data-slot="permission-patterns">
                  <For each={patterns()}>
                    {(pattern, index) => (
                      <div data-slot="permission-pattern-row" data-decision={decision(index())}>
                        <div data-slot="permission-pattern-actions">
                          <Tooltip value={approveTooltip(index())} placement="top">
                            <button
                              data-slot="permission-pattern-toggle"
                              data-variant="approve"
                              data-active={decision(index()) === "approved" ? "" : undefined}
                              disabled={props.responding}
                              onClick={() => togglePattern(index(), "approved")}
                              aria-label={approveTooltip(index())}
                            >
                              <Icon name="check-small" size="small" />
                            </button>
                          </Tooltip>
                          <Tooltip value={denyTooltip(index())} placement="top">
                            <button
                              data-slot="permission-pattern-toggle"
                              data-variant="deny"
                              data-active={decision(index()) === "denied" ? "" : undefined}
                              disabled={props.responding}
                              onClick={() => togglePattern(index(), "denied")}
                              aria-label={denyTooltip(index())}
                            >
                              <Icon name="close-small" size="small" />
                            </button>
                          </Tooltip>
                        </div>
                        <span data-slot="permission-pattern-type">{props.request.toolName}</span>
                        <code data-slot="permission-pattern">{pattern}</code>
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

      <p data-slot="permission-session-hint">{language.t("ui.permission.sessionHint")}</p>
      <div data-slot="permission-actions">
        <Button
          variant="primary"
          size="small"
          onClick={() => {
            const { approved, denied } = collectPatterns()
            props.onDecide("once", approved, denied)
          }}
          disabled={props.responding}
        >
          {language.t("ui.permission.allowOnce")}
        </Button>
        <Button
          variant="secondary"
          size="small"
          onClick={() => {
            const { approved, denied } = collectPatterns()
            props.onDecide("always", approved, denied)
          }}
          disabled={props.responding || hasDeniedPatterns()}
        >
          {language.t("ui.permission.allowAlways")}
        </Button>
        <Button
          variant="ghost"
          size="small"
          onClick={() => {
            const { approved, denied } = collectPatterns()
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
