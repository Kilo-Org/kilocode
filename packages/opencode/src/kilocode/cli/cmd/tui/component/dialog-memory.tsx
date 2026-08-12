import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { MemoryAutosaveStatus } from "@kilocode/kilo-memory/autosave-status"
import { MEMORY_COMMAND_CATALOG } from "@kilocode/kilo-memory/commands"
import { MemoryToken } from "@kilocode/kilo-memory/token"
import { Global } from "@opencode-ai/core/global"
import { createMemo, createResource, For, Match, Show, Switch } from "solid-js"
import { relativeTime } from "@/kilocode/cli/cmd/tui/relative-time"
import { useProject } from "@tui/context/project"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { useTuiConfig } from "@tui/config"
import { useBindings } from "@tui/keymap"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { getScrollAcceleration } from "@tui/util/scroll"
import { route } from "@/kilocode/cli/cmd/tui/memory-command"
import { errorMessage } from "@/util/error"

function fmt(value: number) {
  return value.toLocaleString()
}

function count(text: string) {
  return text.split("\n").filter((line) => line.trim().startsWith("- ")).length
}

function records(text: string) {
  return (text.match(/^record id=/gm) ?? []).length
}

function stored(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => line.split(":: ").at(-1) ?? line)
    .slice(0, 16)
}

export function showMemoryDialog(dialog: DialogContext, input?: { workspace?: string; directory?: string }) {
  dialog.setSize("large")
  dialog.replace(() => <DialogMemory workspace={input?.workspace} directory={input?.directory} />)
}

export function showMemoryHelpDialog(
  dialog: DialogContext,
  input?: { workspace?: string; directory?: string; reason?: string },
) {
  dialog.setSize("large")
  dialog.replace(() => (
    <DialogMemoryHelp workspace={input?.workspace} directory={input?.directory} reason={input?.reason} />
  ))
}

export function showMemoryStatusDialog(dialog: DialogContext, input?: { workspace?: string; directory?: string }) {
  dialog.setSize("large")
  dialog.replace(() => <DialogMemoryStatus workspace={input?.workspace} directory={input?.directory} />)
}

function autosave(state: { autoConsolidate: boolean; stats: MemoryAutosaveStatus.Stats }) {
  const item = MemoryAutosaveStatus.summarize(state)
  if (item.state === "off") return "off"
  if (item.state === "watching") return "on · watching…"
  if (item.state === "saved") return `on · saved · ${relativeTime(item.at)}`
  if (item.state === "handoff") return `on · session handoff saved · ${relativeTime(item.at)}`
  return `on · no changes · ${relativeTime(item.at)}`
}

function MemoryHeaderInfo(props: {
  root: string
  state: {
    enabled: boolean
    scope: string
  }
}) {
  const { theme } = useTheme()
  return (
    <>
      <text fg={theme.text}>
        {props.state.enabled ? "Enabled" : "Disabled"} · {props.state.scope}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {props.root.replace(Global.Path.home, "~")}
      </text>
    </>
  )
}

function MemorySourcesInfo(props: {
  sources: {
    project: string
    environment: string
    corrections: string
  }
}) {
  const { theme } = useTheme()
  return (
    <box>
      <text fg={theme.text}>Sources</text>
      <text fg={theme.textMuted}>
        project.md {count(props.sources.project)} · environment.md {count(props.sources.environment)} · corrections.md{" "}
        {count(props.sources.corrections)}
      </text>
    </box>
  )
}

function MemoryItemsInfo(props: { items: string }) {
  const { theme } = useTheme()
  return (
    <box>
      <text fg={theme.text}>Stored memory</text>
      <Show when={stored(props.items).length > 0} fallback={<text fg={theme.textMuted}>No items</text>}>
        <For each={stored(props.items)}>{(line) => <text fg={theme.textMuted}>{line}</text>}</For>
      </Show>
    </box>
  )
}

function draft(usage: string) {
  const head = usage.split(" ")[0]
  if (usage.includes("<") || usage.includes("|")) return `${head} `
  return usage
}

export function DialogMemoryHelp(props: { workspace?: string; directory?: string; reason?: string }) {
  const sdk = useSDK()
  const project = useProject()
  const dialog = useDialog()
  const { theme } = useTheme()
  const toast = useToast()
  const options: DialogSelectOption<string>[] = MEMORY_COMMAND_CATALOG.map((item) => ({
    title: item.description,
    footer: `/memory ${item.usage}`,
    category: "Memory",
    value: item.usage,
  }))

  return (
    <DialogSelect
      title="Memory"
      options={options}
      flat
      footer={<Show when={props.reason}>{(reason) => <text fg={theme.error}>{reason()}</text>}</Show>}
      onSelect={async (option) => {
        dialog.clear()
        const workspace = props.workspace ?? project.workspace.current()
        const result = await sdk.client.tui.appendPrompt({
          ...route({ workspace, directory: props.directory }),
          text: `/memory ${draft(option.value)}`,
        })
        if (!result.error) return
        toast.show({ variant: "error", message: `Memory menu failed: ${errorMessage(result.error)}` })
      }}
    />
  )
}

function DialogMemoryStatus(props: { workspace?: string; directory?: string }) {
  const sdk = useSDK()
  const project = useProject()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [data, api] = createResource(
    () => `${props.workspace ?? project.workspace.current() ?? "__default__"}:${props.directory ?? ""}`,
    async () => {
      const workspace = props.workspace ?? project.workspace.current()
      const result = await sdk.client.memory.show(route({ workspace, directory: props.directory }))
      if (result.error) throw new Error(errorMessage(result.error))
      if (!result.data) throw new Error("Memory response had no data")
      return result.data
    },
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Memory Status
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Switch>
        <Match when={data.loading}>
          <text fg={theme.textMuted}>Loading memory...</text>
        </Match>
        <Match when={data.error}>
          <text fg={theme.error} wrapMode="word">
            {errorMessage(data.error)}
          </text>
        </Match>
        <Match when={data()}>
          {(item) => (
            <box gap={1}>
              <box>
                <MemoryHeaderInfo root={item().root} state={item().state} />
              </box>
              <box>
                <text fg={theme.text}>Auto-save</text>
                <text fg={theme.textMuted}>{autosave(item().state)}</text>
                <text fg={theme.textMuted} wrapMode="word">
                  Auto-save sends best-effort-redacted turn context to your configured model provider; disable with /memory auto off.
                </text>
              </box>
              <MemorySourcesInfo sources={item().sources} />
              <MemoryItemsInfo items={item().items} />
              <box>
                <text fg={theme.text}>Index</text>
                <text fg={theme.textMuted}>
                  {fmt(records(item().index))} entries · {fmt(MemoryToken.estimate(item().index))} estimated tokens
                </text>
              </box>
            </box>
          )}
        </Match>
      </Switch>
      <box flexDirection="row" justifyContent="flex-start">
        <text fg={theme.textMuted} onMouseUp={() => void api.refetch()}>
          refresh
        </text>
      </box>
    </box>
  )
}

export function DialogMemory(props: { workspace?: string; directory?: string }) {
  const sdk = useSDK()
  const project = useProject()
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const config = useTuiConfig()
  const height = createMemo(() => Math.max(6, Math.min(24, Math.floor(dimensions().height * 0.7) - 5)))
  const scroll = createMemo(() => getScrollAcceleration(config))
  let box: ScrollBoxRenderable | undefined
  const [data, api] = createResource(
    () => `${props.workspace ?? project.workspace.current() ?? "__default__"}:${props.directory ?? ""}`,
    async () => {
      const workspace = props.workspace ?? project.workspace.current()
      const result = await sdk.client.memory.show(route({ workspace, directory: props.directory }))
      if (result.error) throw new Error(errorMessage(result.error))
      if (!result.data) throw new Error("Memory response had no data")
      return result.data
    },
  )

  useBindings(() => ({
    bindings: [
      { key: "pageup", desc: "Scroll memory up", group: "Memory", cmd: () => box?.scrollBy(-height()) },
      { key: "pagedown", desc: "Scroll memory down", group: "Memory", cmd: () => box?.scrollBy(height()) },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Memory
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <scrollbox
        ref={(ref: ScrollBoxRenderable) => (box = ref)}
        height={height()}
        scrollAcceleration={scroll()}
        verticalScrollbarOptions={{ visible: true }}
        viewportOptions={{ paddingRight: 1 }}
      >
        <Switch>
          <Match when={data.loading}>
            <text fg={theme.textMuted}>Loading memory...</text>
          </Match>
          <Match when={data.error}>
            <text fg={theme.error} wrapMode="word">
              {errorMessage(data.error)}
            </text>
          </Match>
          <Match when={data()}>
            {(item) => (
              <box gap={1}>
                <box>
                  <MemoryHeaderInfo root={item().root} state={item().state} />
                </box>
                <MemorySourcesInfo sources={item().sources} />
                <MemoryItemsInfo items={item().items} />
              </box>
            )}
          </Match>
        </Switch>
      </scrollbox>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted} onMouseUp={() => void api.refetch()}>
          refresh
        </text>
        <text fg={theme.textMuted}>pageup/pagedown scroll</text>
      </box>
    </box>
  )
}
