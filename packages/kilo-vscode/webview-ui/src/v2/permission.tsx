import type { FileDiffInfo, PermissionRequest } from "@opencode/client"
import { Button } from "@kilocode/kilo-ui/button"
import { DockPrompt } from "@kilocode/kilo-ui/dock-prompt"
import { Icon } from "@kilocode/kilo-ui/icon"
import { createSignal, For, Show } from "solid-js"
import { PermissionCommand } from "../components/chat/PermissionCommand"
import { useLanguage } from "../context/language"
import { useV2 } from "./client"
import { PermissionDiff } from "./permission-diff"
import { displayResource, widenSaved, widerRule } from "./permission-rules"

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

  const save = () => props.request.save ?? []
  const wider = () => widerRule(props.request)

  const submit = (decision: "once" | "always" | "reject", broader?: string) => {
    if (sending()) return
    setSending(true)
    // The reply removes the request from the store, so keep the one being answered.
    const request = props.request
    const origin = request.save?.[0]
    void v2.data.session.permission
      .reply({ sessionID: request.sessionID, requestID: request.id, decision })
      .then(async () => {
        if (!broader || !origin) return
        const projectID =
          v2.data.session.get(request.sessionID)?.projectID ??
          (await v2.api.session.get({ sessionID: request.sessionID })).projectID
        await widenSaved(v2.api.permission.saved, { projectID, action: request.action, from: origin, to: broader })
      })
      .then(() => window.dispatchEvent(new Event("focusPrompt")))
      .catch(v2.report)
      .finally(() => setSending(false))
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
        <div data-slot="permission-actions">
          <Button variant="primary" size="small" onClick={() => submit("once")} disabled={sending()}>
            {language.t("ui.permission.allowOnce")}
          </Button>
          <Button variant="secondary" size="small" onClick={() => submit("always")} disabled={sending()}>
            {language.t("ui.permission.allowAlways")}
          </Button>
          <Show when={save().length === 1 && wider()}>
            {(rule) => (
              <Button variant="secondary" size="small" onClick={() => submit("always", rule())} disabled={sending()}>
                {language.t("ui.permission.allowAllSites")}
              </Button>
            )}
          </Show>
          <Button variant="ghost" size="small" onClick={() => submit("reject")} disabled={sending()}>
            {language.t("ui.permission.reject")}
          </Button>
        </div>
      </DockPrompt>
    </div>
  )
}
