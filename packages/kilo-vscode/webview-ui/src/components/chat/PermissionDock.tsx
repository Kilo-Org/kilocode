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

import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { DockPrompt } from "@kilocode/kilo-ui/dock-prompt"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useConfig } from "../../context/config"
import {
  describePatterns,
  describeRule,
  displaySkillCommand,
  savedRuleStates,
  type RuleDecision,
} from "./permission-dock-utils"
import { PermissionCommand } from "./PermissionCommand"
import { PermissionDiff } from "./PermissionDiff"
import { permissionDiffs } from "./permission-diff-utils"
import { normalizeUrls } from "../../../../../opencode/src/kilocode/util/url"
import type { PermissionRequest } from "../../types/messages"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"

let rulesExpandedPreference = false

export const PermissionDock: Component<{
  request: PermissionRequest
  responding: boolean
  onDecide: (
    permissionID: string,
    response: "once" | "reject",
    approvedAlways: string[],
    deniedAlways: string[],
    feedback?: string,
  ) => void
}> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const { config } = useConfig()

  const fromChild = () => props.request.sessionID !== session.currentSessionID()
  // Skill shell batches are never persisted, so they show no auto-approve rules. The command
  // list is only shown for the bash ask; the sibling external_directory ask (same skillShell
  // metadata) keeps its normal directory rendering.
  const skillShell = () => props.request.args?.skillShell === true
  const skillShellCommands = () =>
    skillShell() && props.request.toolName === "bash" ? (props.request.args?.commands ?? []) : []
  // Bash sends fine-grained rules via metadata.rules; other tools use the always array.
  const rules = () => props.request.args?.rules ?? props.request.always ?? []
  // Rules like "git *" or "git log *" — strip the trailing wildcard for display.
  // A bare "*" (global wildcard) becomes empty so only the tool name shows.
  const label = (rule: string) => (rule === "*" ? "" : rule.replace(/ \*$/, ""))
  const command = () => {
    const cmd = props.request.args?.command
    if (typeof cmd !== "string") return undefined
    // Normalize IDN/Unicode hostnames to punycode ASCII to prevent homograph attacks.
    return normalizeUrls(cmd)
  }
  const text = (rule: string) => (command() ? label(rule) : describeRule(props.request.toolName, rule, language.t))
  const external = () => props.request.toolName === "external_directory"
  const sandboxEscalation = () => props.request.toolName === "sandbox_escalation"
  const cmdDescription = () => {
    const val = props.request.args?.description
    return typeof val === "string" && val.length > 0 ? val : undefined
  }
  const description = createMemo(() =>
    command() ? null : describePatterns(props.request.toolName, props.request.patterns, language.t),
  )

  const diffs = createMemo(() => permissionDiffs(props.request))

  // Pre-populate toggle states from existing config rules so previously
  // approved/denied patterns show their saved state immediately.
  const saved = config().permission?.[props.request.toolName]
  const loadState = savedRuleStates(rules(), saved)
  // Saved rules are display-only; only explicit toggles can grant new permissions.
  const [decisions, setDecisions] = createSignal<Record<number, RuleDecision>>({})
  const [expanded, setExpanded] = createSignal(rulesExpandedPreference)
  // Rejecting is a two-step flow: Deny reveals an optional feedback field, then Reject confirms.
  const [rejecting, setRejecting] = createSignal(false)
  const [feedback, setFeedback] = createSignal("")

  let root!: HTMLDivElement
  let feedbackRef: HTMLTextAreaElement | undefined

  createEffect(() => {
    void props.request.id
    setRejecting(false)
    setFeedback("")
  })

  const hasRules = () => rules().length > 0 && !skillShell()

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
    const current = decisions()[index] ?? loadState[index] ?? "pending"
    const next = current === decision ? "pending" : decision
    const updated = { ...decisions(), [index]: next }
    setDecisions(updated)
  }

  const decision = (index: number): RuleDecision => decisions()[index] ?? loadState[index] ?? "pending"

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

  const title = () => {
    if (sandboxEscalation()) return language.t("notification.permission.titleSandboxEscalation")
    const skill = props.request.args?.skill
    if (skillShell() && typeof skill === "string" && skill.length > 0)
      // Escape the untrusted skill name so bidi/control chars can't reorder the header text.
      return language.t("notification.permission.titleSkillShell", { skill: displaySkillCommand(skill) })
    return fromChild()
      ? language.t("notification.permission.titleSubagent")
      : language.t("notification.permission.title")
  }

  const focusPrompt = () => requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))

  const submit = (response: "once" | "reject") => {
    if (props.responding) return
    const { approved, denied } = collectRules()
    props.onDecide(props.request.id, response, approved, denied, response === "reject" ? feedback() : undefined)
    setRejecting(false)
    setFeedback("")
    focusPrompt()
  }

  const startReject = () => {
    if (props.responding) return
    setRejecting(true)
    requestAnimationFrame(() => feedbackRef?.focus())
  }

  const cancelReject = () => {
    setRejecting(false)
    setFeedback("")
    focusPrompt()
  }

  const element = (e: KeyboardEvent) => (e.target instanceof Element ? e.target : undefined)

  const control = (target: Element | undefined) =>
    !!target?.closest(
      "button, input, select, textarea, a[href], [contenteditable='true'], [role='button'], [role='menu'], [role='menuitem'], [role='listbox'], [role='option'], [role='combobox'], [role='textbox']",
    )

  const plain = (e: KeyboardEvent) => isEnterKeyCommitNotIme(e) && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey

  const skip = (e: KeyboardEvent, target: Element | undefined) => {
    const local = !!target?.closest("[data-component='permission-shortcuts']")
    const prompt = !!target?.closest("textarea.prompt-input")
    const modal = !!target?.closest("[data-component='dialog'], [data-component='dropdown-menu-content']")
    if (local) return e.key === "Enter"
    if (modal) return true
    if (prompt) return false
    return control(target)
  }

  const handle = (e: KeyboardEvent, response: "once" | "reject") => {
    e.preventDefault()
    e.stopPropagation()
    submit(response)
  }

  const escape = (e: KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (rejecting()) {
      cancelReject()
      return
    }
    startReject()
  }

  const onRoot = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      escape(e)
      return
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (!document.hasFocus()) return
    if (e.defaultPrevented) return
    if (root.getClientRects().length === 0) return

    const target = element(e)

    // Preserve normal Enter behavior for controls inside the permission card,
    // while allowing the shortcut when the prompt input still has focus.
    if (skip(e, target)) return

    if (e.key === "Escape") {
      escape(e)
      return
    }

    if (plain(e)) {
      handle(e, "once")
      return
    }
  }

  // Listen only while this permission is rendered. This keeps shortcuts working
  // when the prompt input owns focus without forcing focus onto the dock.
  createEffect(() => {
    void props.request.id
    document.addEventListener("keydown", onKey, true)
    onCleanup(() => document.removeEventListener("keydown", onKey, true))
  })

  return (
    <div ref={root} data-component="permission-shortcuts" onKeyDown={onRoot}>
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
                              <IconButton
                                icon="check-small"
                                variant="ghost"
                                size="small"
                                data-slot="permission-rule-toggle"
                                tone="success"
                                data-active={decision(index()) === "approved" ? "" : undefined}
                                aria-pressed={decision(index()) === "approved"}
                                disabled={props.responding}
                                onClick={() => toggleRule(index(), "approved")}
                                aria-label={approveTooltip(index())}
                              />
                            </Tooltip>
                            <Tooltip value={denyTooltip(index())} placement="top">
                              <IconButton
                                icon="close-small"
                                variant="ghost"
                                size="small"
                                data-slot="permission-rule-toggle"
                                tone="danger"
                                data-active={decision(index()) === "denied" ? "" : undefined}
                                aria-pressed={decision(index()) === "denied"}
                                disabled={props.responding}
                                onClick={() => toggleRule(index(), "denied")}
                                aria-label={denyTooltip(index())}
                              />
                            </Tooltip>
                          </div>
                          <code data-slot="permission-rule" data-wrap={external() ? "" : undefined} title={text(rule)}>
                            <Show when={external() && rule !== "*"} fallback={text(rule)}>
                              <span data-slot="permission-rule-label">
                                {language.t("ui.permission.toolLabel.externalDirectory")}{" "}
                              </span>
                              <span data-slot="permission-rule-path">{rule}</span>
                            </Show>
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
        {/* Everything above the buttons scrolls: a long command or a large diff must never
            push Allow/Deny out of the clipped chat view. */}
        <div data-slot="permission-scroll">
          {/* Pierre's virtualizer uses the scroll root's first child as its content
              container, so keep all variable-height permission content in one wrapper. */}
          <div data-slot="permission-scroll-content">
            <Show
              when={skillShellCommands().length > 0}
              fallback={
                <>
                  <Show when={cmdDescription()}>
                    {(desc) => (
                      <div data-slot="permission-hint" data-wrap>
                        {desc()}
                      </div>
                    )}
                  </Show>
                  <Show when={command()}>
                    {(cmd) => <PermissionCommand command={cmd()} plain={props.request.args.heredoc === true} />}
                  </Show>

                  {(() => {
                    const desc = description()
                    if (!desc)
                      return !command() && toolDescription() ? (
                        <div data-slot="permission-hint">{toolDescription()}</div>
                      ) : null
                    if (desc.kind === "single")
                      return (
                        <div
                          data-slot="permission-hint"
                          data-wrap={external() ? "" : undefined}
                          title={external() ? desc.text : undefined}
                        >
                          {desc.text}
                        </div>
                      )
                    return (
                      <div data-slot="permission-patterns">
                        <span data-slot="permission-patterns-title">{desc.title}</span>
                        <For each={desc.paths}>{(path) => <code data-slot="permission-pattern">{path}</code>}</For>
                      </div>
                    )
                  })()}
                </>
              }
            >
              {/* Verbatim commands (args.commands), control-char/bidi-escaped so the displayed command matches execution. */}
              <For each={skillShellCommands()}>{(cmd) => <PermissionCommand command={displaySkillCommand(cmd)} />}</For>
            </Show>

            <Show when={diffs().length > 0}>
              <div data-slot="permission-diffs" data-count={diffs().length}>
                <For each={diffs()}>{(diff) => <PermissionDiff filediff={diff} />}</For>
              </div>
            </Show>
          </div>
        </div>

        <Show when={rejecting()}>
          <div data-slot="permission-feedback">
            <textarea
              ref={(el) => (feedbackRef = el)}
              data-slot="permission-feedback-input"
              value={feedback()}
              placeholder={language.t("ui.permission.feedbackPlaceholder")}
              onInput={(e) => setFeedback(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault()
                  e.stopPropagation()
                  cancelReject()
                  return
                }
                // Enter confirms; Shift+Enter keeps the newline for multi-line feedback.
                if (isEnterKeyCommitNotIme(e) && !e.shiftKey) {
                  e.preventDefault()
                  e.stopPropagation()
                  submit("reject")
                }
              }}
            />
            <div data-slot="permission-feedback-hint">{language.t("ui.permission.feedbackHint")}</div>
          </div>
        </Show>

        <div data-slot="permission-actions">
          <Show
            when={rejecting()}
            fallback={
              <>
                <Button variant="primary" size="small" onClick={() => submit("once")} disabled={props.responding}>
                  {language.t("ui.permission.allowOnce")}
                </Button>
                <Button variant="ghost" size="small" onClick={startReject} disabled={props.responding}>
                  {language.t("ui.permission.deny")}
                </Button>
              </>
            }
          >
            <Button
              variant="primary"
              size="small"
              data-slot="permission-reject-confirm"
              onClick={() => submit("reject")}
              disabled={props.responding}
            >
              {language.t("ui.permission.reject")}
            </Button>
            <Button variant="ghost" size="small" onClick={cancelReject} disabled={props.responding}>
              {language.t("ui.common.cancel")}
            </Button>
          </Show>
        </div>
      </DockPrompt>
    </div>
  )
}
