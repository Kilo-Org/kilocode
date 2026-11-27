import type { FileDiffInfo, PermissionRequest } from "@opencode/client"
import { Button } from "@kilocode/kilo-ui/button"
import { DockPrompt } from "@kilocode/kilo-ui/dock-prompt"
import { Icon } from "@kilocode/kilo-ui/icon"
import { createSignal, For, Show } from "solid-js"
import { PermissionCommand } from "../components/chat/PermissionCommand"
import { useLanguage } from "../context/language"
import { isEnterKeyCommitNotIme } from "../utils/ime-enter"
import { useV2 } from "./client"
import { PermissionDiff } from "./permission-diff"
import { allowBroader, displayResource, reasonOf, savable, widerRule } from "./permission-rules"

/** v2 permission actions whose existing label key has another name. */
const LABELS: Record<string, string> = {
  shell: "bash",
  glob: "globSearch",
  grep: "grepSearch",
  webfetch: "webFetch",
  websearch: "webSearch",
  subagent: "task",
  todowrite: "todoWrite",
  external_directory: "externalDirectory",
  browser_open: "browserOpen",
}

export function PermissionDock(props: {
  request: PermissionRequest
  /** Opens the proposed file changes of an edit request; the Agent Manager shows them in its edit preview. */
  onPreview?: (files: FileDiffInfo[], sessionID: string) => void
}) {
  const v2 = useV2()
  const language = useLanguage()
  const [sending, setSending] = createSignal(false)
  // Rejecting is a two-step flow: Deny reveals an optional feedback field, then Reject confirms.
  const [rejecting, setRejecting] = createSignal(false)
  const [feedback, setFeedback] = createSignal("")
  let feedbackRef: HTMLTextAreaElement | undefined
  const command = () => {
    const value = props.request.metadata?.command
    return typeof value === "string" ? value : undefined
  }
  const description = () => {
    const value = props.request.metadata?.description
    return typeof value === "string" ? value : undefined
  }
  // Edit and write requests carry the proposed change as `metadata.files`.
  const files = () => {
    const value = props.request.metadata?.files
    if (!Array.isArray(value)) return []
    return value.filter(
      (item): item is FileDiffInfo =>
        typeof item === "object" && item !== null && !Array.isArray(item) && typeof item.file === "string",
    )
  }
  const action = () => {
    const key = `ui.permission.toolLabel.${LABELS[props.request.action] ?? props.request.action}`
    const value = language.t(key)
    return value === key ? props.request.action : value
  }

  const wider = () => widerRule(props.request)

  const answer = (decision: "once" | "always" | "reject", broader?: string, message?: string) => {
    const request = props.request
    const trimmed = message?.trim()
    const reply = (input: {
      sessionID: string
      requestID: string
      decision: "once" | "always" | "reject"
      message?: string
    }) => v2.data.session.permission.reply(input)
    if (!broader)
      return reply({
        sessionID: request.sessionID,
        requestID: request.id,
        decision,
        ...(trimmed ? { message: trimmed } : {}),
      })
    return allowBroader(
      {
        reply,
        project: (sessionID) => v2.data.session.get(sessionID)?.projectID,
        session: v2.api.session,
        saved: v2.api.permission.saved,
      },
      request,
      broader,
    )
  }

  const submit = (decision: "once" | "always" | "reject", broader?: string, message?: string) => {
    if (sending()) return
    setSending(true)
    void answer(decision, broader, message)
      .then(() => window.dispatchEvent(new Event("focusPrompt")))
      .catch(v2.report)
      .finally(() => setSending(false))
  }

  const startReject = () => {
    if (sending()) return
    setRejecting(true)
    requestAnimationFrame(() => feedbackRef?.focus())
  }

  const cancelReject = () => {
    setRejecting(false)
    setFeedback("")
    window.dispatchEvent(new Event("focusPrompt"))
  }

  return (
    <div data-component="permission-shortcuts">
      <DockPrompt
        kind="permission"
        header={
          <div data-slot="permission-row" data-variant="header">
            <span data-slot="permission-icon">
              <Icon name="warning" size="small" />
            </span>
            <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
          </div>
        }
        footer={null}
      >
        <div data-slot="permission-scroll">
          <div data-slot="permission-scroll-content">
            <Show when={description()}>
              {(text) => (
                <div data-slot="permission-hint" data-wrap>
                  {text()}
                </div>
              )}
            </Show>
            <Show when={props.request.message}>
              {(text) => (
                <div data-slot="permission-hint" data-wrap>
                  {text()}
                </div>
              )}
            </Show>
            <Show when={reasonOf(props.request)}>
              {(reason) => (
                <div data-slot="permission-hint" data-wrap data-reason>
                  {language.t("ui.permission.reason", { reason: reason() })}
                </div>
              )}
            </Show>
            <Show when={command()}>{(text) => <PermissionCommand command={text()} />}</Show>
            <Show when={props.onPreview && files().length > 0}>
              <Button
                variant="ghost"
                size="small"
                data-slot="permission-preview"
                onClick={() => props.onPreview?.(files(), props.request.sessionID)}
              >
                {language.t("agentManager.editPreview.openInPanel")}
              </Button>
            </Show>
            <div data-slot="permission-patterns">
              <span data-slot="permission-patterns-title">{action()}</span>
              <For each={props.request.resources}>
                {(resource) => (
                  <code data-slot="permission-pattern">{displayResource(props.request.action, resource)}</code>
                )}
              </For>
            </div>
            <Show when={files().length > 0}>
              <PermissionDiff files={files()} />
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
                  submit("reject", undefined, feedback())
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
                <Button variant="primary" size="small" onClick={() => submit("once")} disabled={sending()}>
                  {language.t("ui.permission.allowOnce")}
                </Button>
                <Show when={savable(props.request)}>
                  <Button variant="secondary" size="small" onClick={() => submit("always")} disabled={sending()}>
                    {language.t("ui.permission.allowAlways")}
                  </Button>
                </Show>
                <Show when={wider()}>
                  {(rule) => (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => submit("always", rule())}
                      disabled={sending()}
                    >
                      {language.t("ui.permission.allowAllSites")}
                    </Button>
                  )}
                </Show>
                <Button variant="ghost" size="small" onClick={startReject} disabled={sending()}>
                  {language.t("ui.permission.deny")}
                </Button>
              </>
            }
          >
            <Button
              variant="primary"
              size="small"
              data-slot="permission-reject-confirm"
              onClick={() => submit("reject", undefined, feedback())}
              disabled={sending()}
            >
              {language.t("ui.permission.reject")}
            </Button>
            <Button variant="ghost" size="small" onClick={cancelReject} disabled={sending()}>
              {language.t("ui.common.cancel")}
            </Button>
          </Show>
        </div>
      </DockPrompt>
    </div>
  )
}
