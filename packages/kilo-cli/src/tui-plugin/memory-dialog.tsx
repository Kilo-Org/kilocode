import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { MEMORY_COMMAND_CATALOG } from "../memory-command"
import { type MemoryRpcShow, type MemoryRpcStatus } from "../memory-rpc"
import type { MemoryUiClient } from "./memory"

type MemoryRpcClient = ReturnType<MemoryUiClient["rpc"]>

type MemoryDialogProps = {
  readonly context: Plugin.Context
  readonly rpc: MemoryRpcClient
  readonly signal?: AbortSignal
}

type MemoryDialogMode = "show" | "status"

export function showMemoryDialog(props: MemoryDialogProps, mode: MemoryDialogMode) {
  props.context.ui.dialog.set({ size: "large" })
  props.context.ui.dialog.show(() => <MemoryDialog {...props} mode={mode} />)
}

export function showMemoryHelpDialog(context: Plugin.Context, reason?: string) {
  context.ui.dialog.set({ size: "large" })
  context.ui.dialog.show(() => <MemoryHelpDialog context={context} reason={reason} />)
}

function MemoryHelpDialog(props: { readonly context: Plugin.Context; readonly reason?: string }) {
  const theme = props.context.theme
  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <DialogTitle context={props.context} title="Memory" />
      <Show when={props.reason}>{(reason) => <text fg={theme.text.feedback.warning.default}>{reason()}</text>}</Show>
      <text fg={theme.text.subdued}>Explicit local project memory</text>
      <For each={MEMORY_COMMAND_CATALOG}>
        {(item) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.text.action.primary.focused}>/memory {item.usage}</text>
            <text fg={theme.text.subdued}>{item.description}</text>
          </box>
        )}
      </For>
    </box>
  )
}

function MemoryDialog(props: MemoryDialogProps & { readonly mode: MemoryDialogMode }) {
  const theme = props.context.theme
  const dimensions = useTerminalDimensions()
  const height = createMemo(() => Math.max(6, Math.min(24, Math.floor(dimensions().height * 0.7) - 5)))
  const [data, setData] = createSignal<MemoryRpcShow | MemoryRpcStatus>()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string>()
  let revision = 0
  let box: ScrollBoxRenderable | undefined

  const refresh = async () => {
    if (props.signal?.aborted) return
    const current = ++revision
    setLoading(true)
    setError(undefined)
    try {
      const request = memoryRequest(props.context, props.signal)
      const value = props.mode === "show" ? await props.rpc.show({}, request) : await props.rpc.status({}, request)
      if (current !== revision || props.signal?.aborted) return
      setData(value)
    } catch (cause) {
      if (current !== revision || props.signal?.aborted) return
      setData(undefined)
      setError(message(cause))
    } finally {
      if (current === revision && !props.signal?.aborted) setLoading(false)
    }
  }

  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      { bind: "r", title: "Refresh memory", group: "Memory", run: () => void refresh() },
      { bind: "pageup", title: "Scroll memory up", group: "Memory", run: () => box?.scrollBy(-height()) },
      { bind: "pagedown", title: "Scroll memory down", group: "Memory", run: () => box?.scrollBy(height()) },
    ],
  }))

  onMount(() => void refresh())
  onCleanup(() => {
    revision++
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <DialogTitle context={props.context} title={props.mode === "show" ? "Memory" : "Memory status"} />
      <scrollbox
        ref={(value: ScrollBoxRenderable) => (box = value)}
        height={height()}
        verticalScrollbarOptions={{ visible: true }}
        viewportOptions={{ paddingRight: 1 }}
      >
        <Switch>
          <Match when={loading()}>
            <text fg={theme.text.subdued}>Loading memory...</text>
          </Match>
          <Match when={error()}>
            {(value) => (
              <text fg={theme.text.feedback.error.default} wrapMode="word">
                {value()}
              </text>
            )}
          </Match>
          <Match when={data()}>
            {(value) => (
              <box gap={1}>
                <MemoryHeader context={props.context} root={value().root} state={value().state} />
                <Show when={props.mode === "show"}>
                  <MemorySources context={props.context} sources={(value() as MemoryRpcShow).sources} />
                </Show>
                <Show when={props.mode === "status"}>
                  <MemoryStatus context={props.context} status={value() as MemoryRpcStatus} />
                </Show>
              </box>
            )}
          </Match>
        </Switch>
      </scrollbox>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.action.primary.focused} onMouseUp={() => void refresh()}>
          refresh
        </text>
        <text fg={theme.text.subdued}>r refresh · pageup/pagedown scroll</text>
      </box>
    </box>
  )
}

function DialogTitle(props: { readonly context: Plugin.Context; readonly title: string }) {
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={props.context.theme.text.default} attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
      <text fg={props.context.theme.text.subdued} onMouseUp={() => props.context.ui.dialog.clear()}>
        esc
      </text>
    </box>
  )
}

function MemoryHeader(props: {
  readonly context: Plugin.Context
  readonly root: string
  readonly state: MemoryRpcStatus["state"]
}) {
  const theme = props.context.theme
  return (
    <box>
      <text fg={props.state.enabled ? theme.text.feedback.success.default : theme.text.subdued}>
        {props.state.enabled ? "Enabled" : "Disabled"} · {props.state.scope}
      </text>
      <text fg={theme.text.subdued} wrapMode="word">
        {props.context.ui.format.path(props.root)}
      </text>
    </box>
  )
}

function MemorySources(props: { readonly context: Plugin.Context; readonly sources: MemoryRpcShow["sources"] }) {
  const theme = props.context.theme
  const items = Object.entries(props.sources)
  return (
    <box gap={1}>
      <text fg={theme.text.default}>Sources</text>
      <For each={items}>
        {([source, text]) => (
          <box>
            <text fg={theme.text.subdued}>
              {source} · {memoryEntries(text).length} {memoryEntries(text).length === 1 ? "entry" : "entries"}
            </text>
            <Show when={memoryEntries(text).length > 0} fallback={<text fg={theme.text.subdued}>No entries</text>}>
              <For each={memoryEntries(text)}>{(item) => <text fg={theme.text.subdued}>{item}</text>}</For>
            </Show>
          </box>
        )}
      </For>
    </box>
  )
}

function MemoryStatus(props: { readonly context: Plugin.Context; readonly status: MemoryRpcStatus }) {
  const theme = props.context.theme
  return (
    <box gap={1}>
      <box>
        <text fg={theme.text.default}>Automatic consolidation</text>
        <text fg={theme.text.subdued}>{props.status.state.autoConsolidate ? "Enabled" : "Disabled"}</text>
      </box>
      <box>
        <text fg={theme.text.default}>Index</text>
        <text fg={theme.text.subdued}>
          {props.status.index.bytes.toLocaleString()} bytes · {props.status.index.tokens.toLocaleString()} estimated
          tokens
          {props.status.index.truncated ? " · truncated" : ""}
        </text>
      </box>
      <box>
        <text fg={theme.text.default}>Local files</text>
        <text fg={theme.text.subdued}>
          State {props.status.exists.state ? "present" : "missing"} · index{" "}
          {props.status.exists.index ? "present" : "missing"}
        </text>
      </box>
      <Show when={props.status.activity}>
        {(activity) => (
          <box>
            <text fg={theme.text.default}>Activity</text>
            <text fg={theme.text.subdued}>Last injection: {activityTime(activity().lastInjectedAt)}</text>
            <Show when={activity().lastInjectedAt !== null}>
              <text fg={theme.text.subdued}>
                {activity().lastInjectedBytes} bytes · {activity().lastInjectedTokens} estimated tokens injected
              </text>
            </Show>
            <text fg={theme.text.subdued}>Session digest: {activityTime(activity().lastSessionSavedAt)}</text>
            <text fg={theme.text.subdued}>Consolidation: {activityTime(activity().lastTypedConsolidationAt)}</text>
            <Show when={activity().lastTypedConsolidationAt !== null}>
              <text fg={theme.text.subdued}>Last consolidation: {activity().lastOperationCount} operations</text>
            </Show>
          </box>
        )}
      </Show>
    </box>
  )
}

function activityTime(value: number | null) {
  return value === null ? "Not recorded" : new Date(value).toLocaleString()
}

function memoryRequest(context: Plugin.Context, signal?: AbortSignal) {
  const ref = context.location ?? context.data.location.default()
  return {
    ...(signal ? { signal } : {}),
    location: {
      directory: ref.directory,
      ...(ref.workspaceID === undefined ? {} : { workspace: ref.workspaceID }),
    },
  }
}

function memoryEntries(text: string) {
  return text.split("\n").flatMap((line) => {
    const match = line.trim().match(/^-\s+(.+?)\s+::\s+(.+)$/)
    return match ? [`${match[1]} · ${match[2]}`] : []
  })
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return "Unable to read local memory"
}
