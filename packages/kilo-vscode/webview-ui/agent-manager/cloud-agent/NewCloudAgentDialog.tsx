/** @jsxImportSource solid-js */

import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import type { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { KILO_PROVIDER_ID } from "../../../src/shared/provider-model"
import type { useProvider } from "../../src/context/provider"
import type { useSession } from "../../src/context/session"
import { ModelSelectorBase } from "../../src/components/shared/ModelSelector"
import { ModeSwitcherBase } from "../../src/components/shared/ModeSwitcher"
import { initial, options } from "./models"
import type { createCloudSessionState } from "./session-state"

interface NewCloudAgentDialogProps {
  state: ReturnType<typeof createCloudSessionState>
  session: ReturnType<typeof useSession>
  provider: ReturnType<typeof useProvider>
  t: (key: string) => string
  onClose: () => void
}

export function createCloudAgentDialog(
  dialog: ReturnType<typeof useDialog>,
  props: Omit<NewCloudAgentDialogProps, "onClose">,
) {
  let open = false
  return {
    show() {
      if (!props.state.enabled()) return
      open = true
      dialog.show(
        () => <NewCloudAgentDialog {...props} onClose={() => dialog.close()} />,
        () => (open = false),
      )
    },
    close() {
      if (open) dialog.close()
    },
  }
}

export const NewCloudAgentDialog: Component<NewCloudAgentDialogProps> = (props) => {
  const [prompt, setPrompt] = createSignal("")
  const modes = createMemo(() =>
    props.session.agents().filter((item) => item.native && item.mode !== "subagent" && !item.hidden),
  )
  const models = createMemo(() => options(props.provider.models()))
  const [mode, setMode] = createSignal<string>()
  const [model, setModel] = createSignal<string>()
  const [picked, setPicked] = createSignal(false)
  const selection = createMemo(() => {
    const id = model()
    if (!id) return null
    return { providerID: KILO_PROVIDER_ID, modelID: id }
  })

  createEffect(() => {
    const items = modes()
    if (!items.some((item) => item.name === mode())) setMode(items[0]?.name)
  })

  createEffect(() => {
    const items = models()
    if (picked() && items.some((item) => item.id === model())) return
    setModel(initial(items, props.session.selected()))
  })

  createEffect(on(props.state.success, (value, previous) => value !== previous && props.onClose(), { defer: true }))

  onMount(() => {
    props.state.requestCreateContext()
    const sidebar = document.querySelector<HTMLElement>(".am-sidebar")
    const update = () =>
      document.documentElement.style.setProperty(
        "--cloud-dialog-offset",
        `${sidebar?.getBoundingClientRect().width ?? 0}px`,
      )
    const observer = new ResizeObserver(update)
    if (sidebar) observer.observe(sidebar)
    update()
    onCleanup(() => {
      observer.disconnect()
      document.documentElement.style.removeProperty("--cloud-dialog-offset")
    })
  })

  const canSubmit = () => {
    if (props.state.context().status !== "ready") return false
    if (!prompt().trim() || !mode() || !model()) return false
    return !props.state.creating()
  }

  const submit = () => {
    if (!canSubmit()) return
    props.state.create({ prompt: prompt().trim(), mode: mode()!, model: model()! })
  }

  const contextError = () => {
    const context = props.state.context()
    if (context.error) return context.error
    if (context.status === "signed-out") return props.t("agentManager.cloud.signedOut")
    if (context.status === "unavailable") return props.t("agentManager.cloud.create.contextUnavailable")
  }

  return (
    <Dialog title={props.t("agentManager.cloud.create.title")} class="am-cloud-create-shell" fit>
      <div class="am-cloud-create-dialog">
        <div class="am-cloud-create-prompt">
          <TextField
            autofocus
            multiline
            label={props.t("agentManager.cloud.create.prompt")}
            placeholder={props.t("agentManager.cloud.create.promptPlaceholder")}
            value={prompt()}
            onChange={setPrompt}
            disabled={props.state.creating()}
          />
        </div>
        <div class="am-cloud-create-selectors">
          <div class="prompt-input-hint-selectors">
            <ModeSwitcherBase
              agents={modes()}
              value={mode() ?? ""}
              onSelect={setMode}
              deferDismiss
              disabled={props.state.creating()}
            />
            <ModelSelectorBase
              value={selection()}
              models={models()}
              favorites={false}
              label={props.t("agentManager.cloud.create.model")}
              onSelect={(provider, id) => {
                if (provider !== KILO_PROVIDER_ID) return
                setPicked(true)
                setModel(id)
              }}
              placement="top-start"
              portal={false}
              deferDismiss
              disabled={props.state.creating()}
            />
          </div>
        </div>
        <div class="am-cloud-create-errors" aria-live="polite">
          <Show when={contextError()}>
            {(error) => (
              <div class="am-cloud-create-error">
                <Icon name="warning" size="small" />
                <span>{error()}</span>
              </div>
            )}
          </Show>
          <Show when={props.state.createError()}>
            {(error) => (
              <div class="am-cloud-create-error">
                <Icon name="warning" size="small" />
                <span>{error()}</span>
              </div>
            )}
          </Show>
        </div>
        <div class="am-cloud-create-footer">
          <p class="am-cloud-create-note" aria-live="polite">
            <Show
              when={props.state.context().status !== "loading"}
              fallback={
                <>
                  <Spinner class="am-cloud-create-spinner" />
                  <span>{props.t("agentManager.cloud.create.loading")}</span>
                </>
              }
            >
              <Icon name="cloud-upload" size="small" />
              <span>
                {props.t("agentManager.cloud.create.note")}
                <Show when={props.state.context().repository}>
                  {(repository) => (
                    <>
                      {" ("}
                      <span class="am-cloud-create-note-repository" title={repository()}>
                        {repository()}
                      </span>
                      {")"}
                    </>
                  )}
                </Show>
              </span>
            </Show>
          </p>
          <div class="am-cloud-create-actions">
            <Button variant="ghost" size="large" onClick={() => props.onClose()} disabled={props.state.creating()}>
              {props.t("agentManager.cloud.create.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={submit} disabled={!canSubmit()}>
              <Show when={props.state.creating()} fallback={props.t("agentManager.cloud.create.start")}>
                <Spinner class="am-cloud-create-spinner" />
                <span>{props.t("agentManager.cloud.create.creating")}</span>
              </Show>
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
