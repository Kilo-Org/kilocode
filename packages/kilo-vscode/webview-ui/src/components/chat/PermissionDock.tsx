/**
 * PermissionDock component
 * Displays permission requests from the AI assistant in the dock above the prompt input.
 * Uses kilo-ui's DockPrompt component for proper surface styling.
 *
 * Per-rule toggles allow users to approve/deny individual permission rules for future requests.
 * For bash, the hierarchical rules from metadata.rules are shown.
 * For other tools, the always array is shown so users can configure per-tool permissions.
 * The command buttons (Deny / Run) control the current command.
 */

import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { DockPrompt } from "@kilocode/kilo-ui/dock-prompt"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useConfig } from "../../context/config"
import { describePatterns, resolveLabel, savedRuleStates, type RuleDecision } from "./permission-dock-utils"
import { PermissionCommand } from "./PermissionCommand"
import type { PermissionRequest } from "../../types/messages"

let rulesExpandedPreference = false

export const PermissionDock: Component<{
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "reject", approvedAlways: string[], deniedAlways: string[]) => void
}> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const { config } = useConfig()

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
  const description = createMemo(() =>
    command() ? null : describePatterns(props.request.toolName, props.request.patterns, language.t),
  )

  // Pre-populate toggle states from existing config rules so previously
  // approved/denied patterns show their saved state immediately.
  const saved = config().permission?.[props.request.toolName]
  const loadState = savedRuleStates(rules(), saved)
  const [decisions, setDecisions] = createSignal<Record<number, RuleDecision>>(loadState)
  const [expanded, setExpanded] = createSignal(rulesExpandedPreference)

  let root!: HTMLDivElement

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

  const title = () =>
    fromChild() ? language.t("notification.permission.titleSubagent") : language.t("notification.permission.title")

  const focusPrompt = () => requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))

  const onRoot = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName

    // Escape always denies — even from focused buttons — and stopPropagation
    // prevents ChatView's global Escape handler from calling session.abort().
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      if (props.responding) return
      const { approved, denied } = collectRules()
      props.onDecide("reject", approved, denied)
      focusPrompt()
      return
    }

    // Enter approves, but only when focus is on the dock wrapper itself.
    // Skip buttons, inputs, and textareas so Enter activates the focused
    // control (e.g. toggle/expand) instead of approving the permission.
    if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA") return
    if (e.key === "Enter") {
      e.preventDefault()
      e.stopPropagation()
      if (props.responding) return
      const { approved, denied } = collectRules()
      props.onDecide("once", approved, denied)
      focusPrompt()
      return
    }
  }

  // Auto-focus the dock when it appears so keyboard shortcuts work immediately
  createEffect(() => {
    void props.request.id
    requestAnimationFrame(() => root?.focus())
  })

  return (
    <div ref={root} tabIndex={-1} onKeyDown={onRoot} style={{ outline: "none" }}>
      <DockPrompt
        kind="permission"
        header={
          <div data-slot="permission-row" data-variant="header">
            <span data-slot="permission-icon">
              <Icon name="warning" size="small" />
            </span>
            <div data-slot="permission-header-title">{title()}</div>
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
                <span data-slot="permission-rules-header-title">{language.t("ui.permission.manageAutoApprove")}</span>
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
                          <code data-slot="permission-rule">
                            {command()
                              ? label(rule)
                              : rule === "*"
                                ? resolveLabel(props.request.toolName, language.t)
                                : `${resolveLabel(props.request.toolName, language.t)} ${rule}`}
                          </code>
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
        <Show when={command()}>{(cmd) => <PermissionCommand command={cmd()} />}</Show>

        {(() => {
          const desc = description()
          if (!desc)
            return !command() && toolDescription() ? <div data-slot="permission-hint">{toolDescription()}</div> : null
          if (desc.kind === "single") return <div data-slot="permission-hint">{desc.text}</div>
          return (
            <div data-slot="permission-patterns">
              <span data-slot="permission-patterns-title">{desc.title}</span>
              <For each={desc.paths}>{(path) => <code data-slot="permission-pattern">{path}</code>}</For>
            </div>
          )
        })()}

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
            {language.t("ui.permission.run")}
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
    </div>
  )
}
