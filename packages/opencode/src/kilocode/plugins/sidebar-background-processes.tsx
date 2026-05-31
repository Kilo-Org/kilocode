import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiSidebarBackgroundProcessItem } from "@kilocode/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"

const id = "internal:kilo-sidebar-background-processes"

function short(text: string, max = 34) {
  if (text.length <= max) return text
  return text.slice(0, max - 3) + "..."
}

function tone(item: TuiSidebarBackgroundProcessItem, api: TuiPluginApi) {
  const theme = api.theme.current
  if (item.status === "ready" || item.status === "running") return theme.success
  if (item.status === "starting" || item.status === "stopping") return theme.warning
  if (item.status === "failed") return theme.error
  return theme.textMuted
}

function label(item: TuiSidebarBackgroundProcessItem) {
  return item.description?.trim() || item.command
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.session.processes(props.session_id))

  return (
    <Show when={list().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Background Processes</b>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => (
              <box>
                <text fg={theme().textMuted} wrapMode="none">
                  <span style={{ fg: tone(item, props.api) }}>●</span> {short(label(item))}
                </text>
                <text fg={theme().textMuted}>{short(item.command)}</text>
                <Show when={item.pid}>
                  {(pid) => <text fg={theme().textMuted}>PID: {pid()}</text>}
                </Show>
                <Show when={item.ports.length > 0}>
                  <text fg={theme().textMuted}>PORTS: {item.ports.join(", ")}</text>
                </Show>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 250,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
