import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { MemoryAutosaveStatus } from "@kilocode/kilo-memory/autosave-status"
import { MEMORY_COMMAND_CATALOG } from "@kilocode/kilo-memory/commands"
import { MemoryDecisions } from "@kilocode/kilo-memory/decisions"
import { MemoryToken } from "@kilocode/kilo-memory/token"
import { Global } from "@opencode-ai/core/global"
import { createMemo, createResource, For, Match, Show, Switch } from "solid-js"
import { relativeTime } from "@/cli/cmd/tui/feature-plugins/session/util"
import { useProject } from "@/cli/cmd/tui/context/project"
import { useSDK } from "@/cli/cmd/tui/context/sdk"
import { useTheme } from "@/cli/cmd/tui/context/theme"
import { useTuiConfig } from "@/cli/cmd/tui/context/tui-config"
import { useBindings } from "@/cli/cmd/tui/keymap"
import { useDialog, type DialogContext } from "@/cli/cmd/tui/ui/dialog"
import { getScrollAcceleration } from "@/cli/cmd/tui/util/scroll"
import { route } from "@/kilocode/cli/cmd/tui/memory-command"
import { errorMessage } from "@/util/error"

function fmt(value: number) {
  return value.toLocaleString()
}

function saved(state: { autoConsolidate: boolean; stats: MemoryAutosaveStatus.Stats }) {
  const item = MemoryAutosaveStatus.summarize(state)
  if (item.state === "saved") return `${fmt(item.count)} ${item.count === 1 ? "change" : "changes"}`
  if (item.state === "handoff") return "session handoff"
  return "no changes"
}

function count(text: string) {
  return text.split("\n").filter((line) => line.trim().startsWith("- ")).length
}

function records(text: string) {
  return (text.match(/^record id=/gm) ?? []).length
}

function preview(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 16)
}

function tail(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .slice(-8)
}

function savedOperations(input: MemoryDecisions.Operation[]) {
  const text = input
    .map((item) => {
      if (item.type === "remove") return item.query ? `remove:${item.query}` : "remove"
      return `${item.file}:${item.key}`
    })
    .join(", ")
  return text || "none"
}

function skip(item: MemoryDecisions.Skipped | undefined) {
  if (!item) return "none"
  const dupe = item.duplicateOf ? ` duplicate of ${item.duplicateOf}` : ""
  return `${item.reason}${dupe}`
}

function audit(text: string) {
  const item = MemoryDecisions.summarize(text)
  return [
    `last save attempt: ${
      item.lastSave ? `${item.lastSave.result}${item.lastSave.reason ? ` (${item.lastSave.reason})` : ""}` : "none"
    }`,
    `latest saved changes: ${savedOperations(item.latestOperations)}`,
    `latest skipped: ${skip(item.latestSkipped)}`,
    `accepted saves: ${item.accepted} · skipped candidates: ${item.skipped}`,
    `fallback used: ${item.fallback ? "yes" : "no"} · files updated: ${item.files.join(", ") || "none"}`,
    `last recall query: ${item.lastRecall?.query ?? "none"}`,
    `matched topics: ${item.lastRecall?.topics.join(", ") || "none"} · recalled files: ${
      item.lastRecall?.files.join(", ") || "none"
    }`,
    `errors: ${item.errors.join(", ") || "none"}`,
  ]
}

export function showMemoryDialog(dialog: DialogContext, input?: { workspace?: string; directory?: string }) {
  dialog.setSize("large")
  dialog.replace(() => <DialogMemory workspace={input?.workspace} directory={input?.directory} />)
}

export function showMemoryHelpDialog(dialog: DialogContext, reason?: string) {
  dialog.setSize("large")
  dialog.replace(() => <DialogMemoryHelp reason={reason} />)
}

export function showMemoryStatusDialog(dialog: DialogContext, input?: { workspace?: string; directory?: string }) {
  dialog.setSize("large")
  dialog.replace(() => <DialogMemoryStatus workspace={input?.workspace} directory={input?.directory} />)
}

function autosave(state: { autoConsolidate: boolean; stats: MemoryAutosaveStatus.Stats }) {
  const item = MemoryAutosaveStatus.summarize(state)
  if (item.state === "off") return "off"
  if (item.state === "watching") return "watching…"
  if (item.state === "saved") {
    return `${fmt(item.count)} ${item.count === 1 ? "change" : "changes"} · ${relativeTime(item.at)}`
  }
  if (item.state === "handoff") return `session handoff saved · ${relativeTime(item.at)}`
  return `no changes · ${relativeTime(item.at)}`
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

export function DialogMemoryHelp(props: { reason?: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

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
      <Show when={props.reason}>
        {(reason) => <text fg={theme.error}>{reason()}</text>}
      </Show>
      <box gap={0}>
        <For each={MEMORY_COMMAND_CATALOG}>
          {(item) => (
            <box flexDirection="row" gap={2}>
              <text fg={theme.text} flexShrink={0}>
                /memory {item.usage}
              </text>
              <text fg={theme.textMuted} wrapMode="word">
                {item.description}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
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
              </box>
              <box>
                <text fg={theme.text}>Startup context</text>
                <text fg={theme.textMuted}>
                  {item().state.autoInject ? "on" : "off"} · last injected{" "}
                  {fmt(item().state.stats.lastInjectedTokens)} tokens
                </text>
              </box>
              <MemorySourcesInfo sources={item().sources} />
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
                  <text fg={theme.textMuted}>startup context {item().state.autoInject ? "on" : "off"}</text>
                  <text fg={theme.textMuted}>
                    last startup context {fmt(item().state.stats.lastInjectedTokens)} tokens · stored index{" "}
                    {fmt(item().index.length)} chars
                  </text>
                  <Show when={item().state.stats.lastConsolidationTokens > 0}>
                    <text fg={theme.textMuted}>
                      last auto-save {saved(item().state)} · model usage{" "}
                      {fmt(item().state.stats.lastConsolidationTokens)} tokens
                    </text>
                  </Show>
                </box>
                <MemorySourcesInfo sources={item().sources} />
                <box>
                  <text fg={theme.text}>Index</text>
                  <Show when={preview(item().index).length > 0} fallback={<text fg={theme.textMuted}>No entries</text>}>
                    <For each={preview(item().index)}>{(line) => <text fg={theme.textMuted}>{line}</text>}</For>
                  </Show>
                </box>
                <box>
                  <text fg={theme.text}>Items</text>
                  <Show when={preview(item().items).length > 0} fallback={<text fg={theme.textMuted}>No items</text>}>
                    <For each={preview(item().items)}>{(line) => <text fg={theme.textMuted}>{line}</text>}</For>
                  </Show>
                </box>
                <box>
                  <text fg={theme.text}>Changes</text>
                  <Show when={tail(item().changes).length > 0} fallback={<text fg={theme.textMuted}>No changes</text>}>
                    <For each={tail(item().changes)}>{(line) => <text fg={theme.textMuted}>{line}</text>}</For>
                  </Show>
                </box>
                <box>
                  <text fg={theme.text}>Decisions</text>
                  <Show
                    when={tail(item().decisions).length > 0}
                    fallback={<text fg={theme.textMuted}>No decisions</text>}
                  >
                    <text fg={theme.textMuted}>Summary</text>
                    <For each={audit(item().decisions)}>{(line) => <text fg={theme.textMuted}>{line}</text>}</For>
                    <text fg={theme.textMuted}>Recent</text>
                    <For each={tail(item().decisions)}>{(line) => <text fg={theme.textMuted}>{line}</text>}</For>
                  </Show>
                </box>
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
