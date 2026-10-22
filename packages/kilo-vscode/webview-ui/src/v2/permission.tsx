import type { PermissionRequest } from "@opencode/client"
import { Button } from "@kilocode/kilo-ui/button"
import { DockPrompt } from "@kilocode/kilo-ui/dock-prompt"
import { Icon } from "@kilocode/kilo-ui/icon"
import { createSignal, For, Show } from "solid-js"
import { PermissionCommand } from "../components/chat/PermissionCommand"
import { useLanguage } from "../context/language"
import { useV2 } from "./client"

export function PermissionDock(props: { request: PermissionRequest }) {
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
  const action = () => {
    const key = `ui.permission.toolLabel.${props.request.action}`
    const value = language.t(key)
    return value === key ? props.request.action : value
  }

  const submit = (decision: "once" | "always" | "reject") => {
    if (sending()) return
    setSending(true)
    void v2.data.session.permission
      .reply({ sessionID: props.request.sessionID, requestID: props.request.id, decision })
      .then(() => window.dispatchEvent(new Event("focusPrompt")))
      .catch(v2.report)
      .finally(() => setSending(false))
  }

  return (
    <div data-component="permission-dock">
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
              <div data-slot="permission-patterns">
                <span data-slot="permission-patterns-title">{action()}</span>
                <For each={props.request.resources}>
                  {(resource) => <code data-slot="permission-pattern">{resource}</code>}
                </For>
              </div>
            </div>
          </div>
          <div data-slot="permission-actions">
            <Button variant="primary" size="small" onClick={() => submit("once")} disabled={sending()}>
              {language.t("ui.permission.allowOnce")}
            </Button>
            <Button variant="secondary" size="small" onClick={() => submit("always")} disabled={sending()}>
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="ghost" size="small" onClick={() => submit("reject")} disabled={sending()}>
              {language.t("ui.permission.reject")}
            </Button>
          </div>
        </DockPrompt>
      </div>
    </div>
  )
}
