import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Global } from "@opencode-ai/core/global"
import { createMemo, createResource, For, Match, Show, Switch } from "solid-js"
import { useProject } from "@/cli/cmd/tui/context/project"
import { useSDK } from "@/cli/cmd/tui/context/sdk"
import { useTheme } from "@/cli/cmd/tui/context/theme"
import { useTuiConfig } from "@/cli/cmd/tui/context/tui-config"
import { useBindings } from "@/cli/cmd/tui/keymap"
import { useDialog, type DialogContext } from "@/cli/cmd/tui/ui/dialog"
import { getScrollAcceleration } from "@/cli/cmd/tui/util/scroll"

function msg(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch (_error) {
    return String(error)
  }
}

function fmt(value: number) {
  return value.toLocaleString()
}

function saved(value: number) {
  if (value > 0) return `${fmt(value)} ${value === 1 ? "op" : "ops"}`
  return "checked · no new memory"
}

function count(text: string) {
  return text.split("\n").filter((line) => line.trim().startsWith("- ")).length
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

type Decision = {
  kind?: string
  result?: string
  reason?: string
  fallback?: boolean
  operationCount?: number
  skippedCount?: number
  query?: string
  topics?: string[]
  files?: string[]
  skipped?: { reason?: string; text?: string; duplicateOf?: string }[]
  operations?: {
    action?: string
    file?: string
    section?: string
    key?: string
    query?: string
  }[]
}

function parse(line: string) {
  try {
    const value = JSON.parse(line) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    return value as Decision
  } catch (_error) {
    return undefined
  }
}

function unique(input: string[]) {
  return [...new Set(input.filter(Boolean))]
}

function ops(input: Decision | undefined) {
  const items = input?.operations ?? []
  const text = items
    .map((item) => {
      if (item.action === "remove") return item.query ? `remove:${item.query}` : "remove"
      if (!item.key) return ""
      return `${item.file ?? "memory"}:${item.key}`
    })
    .filter(Boolean)
    .join(", ")
  return text || "none"
}

function skip(input: Decision | undefined) {
  const item = input?.skipped?.at(-1)
  if (!item) return "none"
  const dupe = item.duplicateOf ? ` duplicate of ${item.duplicateOf}` : ""
  return `${item.reason ?? "skipped"}${dupe}`
}

function audit(text: string) {
  const items = text
    .split("\n")
    .map((line) => parse(line))
    .filter((item): item is Decision => Boolean(item))
  const saves = items.filter((item) => item.kind === "typed")
  const recalls = items.filter((item) => item.kind === "recall")
  const save = saves.at(-1)
  const recall = recalls.at(-1)
  const accepted = saves.reduce((sum, item) => sum + (item.operationCount ?? 0), 0)
  const skipped = saves.reduce((sum, item) => sum + (item.skippedCount ?? 0), 0)
  const fallback = saves.some((item) => item.fallback || item.result === "fallback")
  const files = unique(saves.flatMap((item) => item.files ?? [])).join(", ") || "none"
  const topics = unique(recall?.topics ?? []).join(", ") || "none"
  const errors = unique(
    items
      .filter((item) => item.result === "error" || item.reason === "parse_error")
      .map((item) => item.reason ?? "error"),
  ).join(", ")
  return [
    `last save attempt: ${save ? `${save.result ?? "unknown"}${save.reason ? ` (${save.reason})` : ""}` : "none"}`,
    `latest saved ops: ${ops(save)}`,
    `latest skipped: ${skip(save)}`,
    `accepted saves: ${accepted} · skipped candidates: ${skipped}`,
    `fallback used: ${fallback ? "yes" : "no"} · files updated: ${files}`,
    `last recall query: ${recall?.query ?? "none"}`,
    `matched topics: ${topics} · recalled files: ${(recall?.files ?? []).join(", ") || "none"}`,
    `errors: ${errors || "none"}`,
  ]
}

function route(input: { workspace?: string; directory?: string }) {
  return {
    ...(input.workspace ? { workspace: input.workspace } : input.directory ? { directory: input.directory } : {}),
  }
}

export function showMemoryDialog(dialog: DialogContext, input?: { workspace?: string; directory?: string }) {
  dialog.setSize("large")
  dialog.replace(() => <DialogMemory workspace={input?.workspace} directory={input?.directory} />)
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
      if (result.error) throw new Error(msg(result.error))
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
              {msg(data.error)}
            </text>
          </Match>
          <Match when={data()}>
            {(item) => (
              <box gap={1}>
                <box>
                  <text fg={theme.text}>
                    {item().state.enabled ? "Enabled" : "Disabled"} · {item().state.scope}
                  </text>
                  <text fg={theme.textMuted}>{item().root.replace(Global.Path.home, "~")}</text>
                  <text fg={theme.textMuted}>startup context on</text>
                  <text fg={theme.textMuted}>
                    last startup context {fmt(item().state.stats.lastInjectedTokens)} tokens · stored index{" "}
                    {fmt(item().index.length)} chars
                  </text>
                  <Show when={item().state.stats.lastConsolidationTokens > 0}>
                    <text fg={theme.textMuted}>
                      last auto-save {saved(item().state.stats.lastOperationCount)} · model usage{" "}
                      {fmt(item().state.stats.lastConsolidationTokens)} tokens
                    </text>
                  </Show>
                </box>
                <box>
                  <text fg={theme.text}>Sources</text>
                  <text fg={theme.textMuted}>
                    project.md {count(item().sources.project)} · environment.md {count(item().sources.environment)} ·
                    corrections.md {count(item().sources.corrections)}
                  </text>
                </box>
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
                    <For each={audit(item().decisions)}>{(line) => <text fg={theme.textMuted}>{line}</text>}</For>
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
