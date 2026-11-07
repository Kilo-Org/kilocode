// kilocode_change - new file
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createSignal, Show } from "solid-js"
import { readSound, writeSound, readNotifications, writeNotifications } from "./notifications-config"

const id = "internal:kilo-notifications-sidebar"

function Toggle(props: {
  label: string
  value: boolean
  onToggle: () => void
  api: TuiPluginApi
}) {
  const theme = () => props.api.theme.current
  return (
    <box flexDirection="row" onMouseDown={props.onToggle}>
      <text fg={theme().textMuted}>  • </text>
      <text fg={theme().text}>{props.label.padEnd(12)}</text>
      <text fg={props.value ? theme().success : theme().error}>
        {props.value ? "ON" : "OFF"}
      </text>
    </box>
  )
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [open, setOpen] = createSignal(false)
  const [sound, setSound] = createSignal(readSound(props.api.kv))
  const [notifications, setNotifications] = createSignal(readNotifications(props.api.kv))

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => setOpen((value) => !value)}>
        <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
        <text fg={theme().text}>
          <b>Notifications</b>
        </text>
      </box>
      <Show when={open()}>
        <box paddingLeft={1}>
          <Toggle
            label="Sound"
            value={sound()}
            api={props.api}
            onToggle={() => {
              const next = !sound()
              setSound(next)
              writeSound(props.api.kv, next)
            }}
          />
          <Toggle
            label="Popup"
            value={notifications()}
            api={props.api}
            onToggle={() => {
              const next = !notifications()
              setNotifications(next)
              writeNotifications(props.api.kv, next)
            }}
          />
        </box>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    // Menaikkan order agar posisinya berada di bawah panel Memory
    order: 900, 
    slots: {
      sidebar_content(_ctx, _props) {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = { id, tui }

export default plugin
