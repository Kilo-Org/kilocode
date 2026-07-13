import type { BackgroundProcessInfo } from "@kilocode/sdk/v2"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useProject } from "@tui/context/project"
import { useBindings } from "@tui/keymap"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useTuiConfig } from "@tui/context/tui-config"
import { useToast } from "@tui/ui/toast"
import { getScrollAcceleration } from "@tui/util/scroll"
import { errorMessage } from "@/util/error"
import { Locale } from "@/util/locale"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import stripAnsi from "strip-ansi"

type Info = BackgroundProcessInfo
type Status = Info["status"]
type Scope = "session" | "all"
type Kind = "stop" | "restart"
type Theme = ReturnType<typeof useTheme>["theme"]

function terminal(status: Status) {
  return status === "exited" || status === "failed" || status === "stopped"
}

function rank(status: Status) {
  if (status === "starting" || status === "stopping") return 0
  if (status === "ready" || status === "running") return 1
  if (status === "failed") return 2
  return 3
}

function tone(status: Status, theme: Theme) {
  if (status === "ready" || status === "running") return theme.success
  if (status === "starting" || status === "stopping") return theme.warning
  if (status === "failed") return theme.error
  return theme.textMuted
}

function label(item: Info) {
  return item.description?.trim() || item.command
}

function short(text: string, max = 64) {
  return Locale.truncate(text, max)
}

function ports(item: Info) {
  return item.ports.length > 0 ? item.ports.join(", ") : "none"
}

function useActions() {
  const project = useProject()
  const sdk = useSDK()
  const toast = useToast()
  const [busy, setBusy] = createSignal<{ id: string; kind: Kind }>()

  async function run(kind: Kind, item: Info) {
    if (busy()) return
    if (kind === "stop" && terminal(item.status)) return

    setBusy({ id: item.id, kind })
    const workspace = project.workspace.current()
    try {
      const result =
        kind === "stop"
          ? await sdk.client.backgroundProcess.stop({ processID: item.id, workspace })
          : await sdk.client.backgroundProcess.restart({ processID: item.id, workspace })

      if (result.error) {
        toast.show({
          variant: "error",
          title: kind === "stop" ? "Failed to stop process" : "Failed to restart process",
          message: errorMessage(result.error),
        })
      }
    } catch (err) {
      toast.show({
        variant: "error",
        title: kind === "stop" ? "Failed to stop process" : "Failed to restart process",
        message: errorMessage(err),
      })
    } finally {
      setBusy(undefined)
    }
  }

  return { busy, run }
}

function StatusMark(props: { status: Status }) {
  const { theme } = useTheme()
  return <text fg={tone(props.status, theme)}>*</text>
}

function Hint(props: { title: string; keys: string; disabled?: boolean; onClick?: () => void }) {
  const { theme } = useTheme()
  return (
    <text fg={props.disabled ? theme.textMuted : theme.text} onMouseUp={() => !props.disabled && props.onClick?.()}>
      <span style={{ attributes: TextAttributes.BOLD }}>{props.title}</span>{" "}
      <span style={{ fg: theme.textMuted }}>{props.keys}</span>
    </text>
  )
}

function session(sync: ReturnType<typeof useSync>, id: string) {
  return sync.data.session.find((item) => item.id === id)?.title
}

function sort(list: Info[]) {
  return list.toSorted(
    (a, b) => rank(a.status) - rank(b.status) || b.time.updated - a.time.updated || a.id.localeCompare(b.id),
  )
}

function all(sync: ReturnType<typeof useSync>) {
  return Object.values(sync.data.background_process).flat()
}

function currentProcesses(sync: ReturnType<typeof useSync>, sessionID: string) {
  return all(sync).filter((item) => item.sessionID === sessionID || item.lifetime === "persistent")
}

export function DialogProcessList() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const actions = useActions()
  const sid = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const [scope, setScope] = createSignal<Scope>(sid() ? "session" : "all")
  const mode = createMemo<Scope>(() => (scope() === "session" && sid() ? "session" : "all"))

  const list = createMemo(() => {
    const current = sid()
    const items = mode() === "session" && current ? currentProcesses(sync, current) : all(sync)
    return sort(items)
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const busy = actions.busy()
    return list().map((item) => {
      const note = mode() === "all" ? session(sync, item.sessionID) : undefined
      const footer =
        busy?.id === item.id ? `${busy.kind === "stop" ? "stopping" : "restarting"}...` : item.pid?.toString()
      const title = `${note ? `(${note}) ` : ""}${label(item)} - ${item.command}`

      return {
        title: short(title, 92),
        value: item.id,
        footer,
        gutter: () => <StatusMark status={item.status} />,
      }
    })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title={mode() === "session" ? "Background Processes (current session)" : "Background Processes (all sessions)"}
      options={options()}
      skipFilter={options().length === 0}
      onSelect={(option) => {
        dialog.replace(() => (
          <DialogProcessDetail id={option.value} back={() => dialog.replace(() => <DialogProcessList />)} />
        ))
      }}
      actions={[
        {
          command: "background_process.stop",
          title: "stop",
          onTrigger: (option) => {
            const item = list().find((proc) => proc.id === option.value)
            if (item) void actions.run("stop", item)
          },
        },
        {
          command: "background_process.restart",
          title: "restart",
          onTrigger: (option) => {
            const item = list().find((proc) => proc.id === option.value)
            if (item) void actions.run("restart", item)
          },
        },
        {
          command: "background_process.scope.toggle",
          title: mode() === "session" ? "all" : "current",
          disabled: !sid(),
          side: "right",
          onTrigger: () => {
            setScope((value) => (value === "session" ? "all" : "session"))
          },
        },
      ]}
      bindings={[
        { key: "ctrl+o", cmd: "background_process.stop" },
        { key: "ctrl+r", cmd: "background_process.restart" },
        { key: "ctrl+a", cmd: "background_process.scope.toggle" },
      ]}
    />
  )
}

function DialogProcessDetail(props: { id: string; back: () => void }) {
  const dialog = useDialog()
  const sync = useSync()
  const actions = useActions()
  const dimensions = useTerminalDimensions()
  const config = useTuiConfig()
  const { theme } = useTheme()
  const item = createMemo(() => all(sync).find((proc) => proc.id === props.id))
  const output = createMemo(() => stripAnsi(item()?.output ?? ""))
  const height = createMemo(() => Math.max(4, Math.floor(dimensions().height / 2) - 14))
  const busy = createMemo(() => actions.busy()?.id === props.id)
  const stopped = createMemo(() => {
    const proc = item()
    return proc ? terminal(proc.status) : true
  })
  const scroll = createMemo(() => getScrollAcceleration(config))
  let box: ScrollBoxRenderable | undefined

  onMount(() => {
    dialog.setSize("large")
  })

  useBindings(() => ({
    bindings: [
      { key: "backspace", desc: "Back", group: "Process", cmd: props.back },
      {
        key: "ctrl+o",
        desc: "Stop process",
        group: "Process",
        cmd: () => {
          const proc = item()
          if (proc) void actions.run("stop", proc)
        },
      },
      {
        key: "ctrl+r",
        desc: "Restart process",
        group: "Process",
        cmd: () => {
          const proc = item()
          if (proc) void actions.run("restart", proc)
        },
      },
      { key: "pageup", desc: "Scroll up", group: "Process", cmd: () => box?.scrollBy(-height()) },
      { key: "pagedown", desc: "Scroll down", group: "Process", cmd: () => box?.scrollBy(height()) },
    ],
  }))

  return (
    <box paddingLeft={4} paddingRight={4} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {item() ? short(label(item()!), 92) : "Background Process"}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={item()} fallback={<text fg={theme.textMuted}>Process is no longer tracked.</text>}>
        {(proc) => (
          <>
            <box>
              <text fg={theme.textMuted} wrapMode="word">
                Name: {label(proc())}
              </text>
              <text fg={theme.textMuted}>
                Status:{" "}
                <span style={{ fg: tone(proc().status, theme), attributes: TextAttributes.BOLD }}>{proc().status}</span>
              </text>
              <text fg={theme.textMuted}>PID: {proc().pid ?? "none"}</text>
              <text fg={theme.textMuted}>Ports: {ports(proc())}</text>
              <Show when={proc().exitCode !== undefined}>
                <text fg={theme.textMuted}>Exit: {proc().exitCode}</text>
              </Show>
              <Show when={proc().signal}>{(signal) => <text fg={theme.textMuted}>Signal: {signal()}</text>}</Show>
              <text fg={theme.textMuted}>Started: {Locale.datetime(proc().time.started)}</text>
              <text fg={theme.textMuted}>Updated: {Locale.datetime(proc().time.updated)}</text>
              <Show when={proc().time.ended}>
                {(ended) => <text fg={theme.textMuted}>Ended: {Locale.datetime(ended())}</text>}
              </Show>
              <text fg={theme.textMuted} wrapMode="word">
                CWD: {proc().cwd}
              </text>
              <text fg={theme.textMuted} wrapMode="word">
                Command: {proc().command}
              </text>
            </box>
            <box>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                Output Buffer
              </text>
              <scrollbox
                ref={(ref: ScrollBoxRenderable) => (box = ref)}
                height={height()}
                scrollAcceleration={scroll()}
                stickyScroll={true}
                stickyStart="bottom"
                verticalScrollbarOptions={{ visible: true }}
              >
                <Show when={output()} fallback={<text fg={theme.textMuted}>No output yet</text>}>
                  {(text) => (
                    <text fg={theme.text} wrapMode="word">
                      {text()}
                    </text>
                  )}
                </Show>
              </scrollbox>
            </box>
            <box flexDirection="row" justifyContent="space-between" paddingTop={1}>
              <box flexDirection="row" gap={2}>
                <Hint title="back" keys="backspace" onClick={props.back} />
                <Hint
                  title={busy() ? "stopping" : "stop"}
                  keys="ctrl+o"
                  disabled={busy() || stopped()}
                  onClick={() => void actions.run("stop", proc())}
                />
                <Hint
                  title={busy() ? "restarting" : "restart"}
                  keys="ctrl+r"
                  disabled={busy()}
                  onClick={() => void actions.run("restart", proc())}
                />
              </box>
              <text fg={theme.textMuted}>pageup/pagedown scroll</text>
            </box>
          </>
        )}
      </Show>
    </box>
  )
}
