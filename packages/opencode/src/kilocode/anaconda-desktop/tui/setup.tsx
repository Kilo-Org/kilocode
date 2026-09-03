import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import open from "open"
import { useTheme } from "@tui/context/theme"
import { useSDK } from "@tui/context/sdk"
import { useBindings } from "@tui/keymap"
import { useDialog } from "@tui/ui/dialog"
import { Link } from "@tui/ui/link"
import { useToast } from "@tui/ui/toast"
import { PROVIDER_ID } from "../domain"
import { complete, createSetupController, setupView, type SetupAction, type SetupState } from "./model"

type ModelComponent = (props: { providerID?: string }) => JSX.Element

export function selectProvider(input: {
  providerID: string
  replace(component: () => JSX.Element): void
  model: ModelComponent
}) {
  if (input.providerID !== PROVIDER_ID) return false
  input.replace(() => <AnacondaDesktopSetup model={input.model} />)
  return true
}

function errorMessage(error: unknown, fallback: string) {
  if (typeof error !== "object" || error === null || !("message" in error)) return fallback
  return typeof error.message === "string" && error.message ? error.message : fallback
}

export function AnacondaDesktopSetup(props: { model: ModelComponent }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const Model = props.model
  const [state, setState] = createSignal<SetupState>({ phase: "idle" })
  const view = createMemo(() => setupView(state().status))

  const controller = createSetupController({
    api: {
      async status(signal) {
        const result = await sdk.client.anacondaDesktop.status(undefined, { signal })
        if (result.data) return result.data
        throw new Error(errorMessage(result.error, "Anaconda Desktop status could not be checked."))
      },
      async open(signal) {
        const result = await sdk.client.anacondaDesktop.open(undefined, { signal })
        if (result.data) return
        throw new Error(errorMessage(result.error, "Anaconda Desktop could not be opened."))
      },
      async sync(acknowledgeToolLimitations, signal) {
        const result = await sdk.client.anacondaDesktop.sync({ acknowledgeToolLimitations }, { signal })
        if (result.data) return result.data
        throw new Error(errorMessage(result.error, "The Anaconda Desktop connection could not be synchronized."))
      },
    },
    change: setState,
    synced(_, signal) {
      complete({
        pick: () => dialog.replace(() => <Model providerID={PROVIDER_ID} />),
        signal,
      })
    },
  })

  const run = (action: SetupAction) => {
    if (action === "refresh") return void controller.refresh()
    if (action === "open") return void controller.open()
    if (action === "connect") return void controller.connect()
    const url = view().downloadURL
    if (!url) return
    void open(url).catch(toast.error)
  }

  useBindings(() => ({
    bindings: view().actions.map((action) => ({
      key: action.key,
      desc: action.label,
      group: "Dialog",
      cmd: () => run(action.type),
    })),
  }))

  onMount(controller.start)
  onCleanup(controller.stop)

  const activity = createMemo(() => {
    if (state().phase === "checking") return "Checking Desktop status..."
    if (state().phase === "opening") return "Opening Anaconda Desktop..."
    if (state().phase === "syncing") return "Synchronizing provider and models..."
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={view().warning ? theme.warning : theme.text}>
          {view().title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <box gap={0}>
        <For each={view().lines}>{(line) => <text fg={theme.textMuted}>{line}</text>}</For>
      </box>

      <Show when={view().downloadURL}>{(url) => <Link href={url()} fg={theme.primary} wrapMode="word" />}</Show>

      <Show when={state().error}>{(error) => <text fg={theme.error}>{error()}</text>}</Show>
      <Show when={activity()}>{(message) => <text fg={theme.textMuted}>{message()}</text>}</Show>

      <box gap={0}>
        <For each={view().actions}>
          {(action) => (
            <text fg={theme.text} onMouseUp={() => run(action.type)}>
              {action.key} <span style={{ fg: theme.textMuted }}>{action.label}</span>
            </text>
          )}
        </For>
      </box>
    </box>
  )
}
