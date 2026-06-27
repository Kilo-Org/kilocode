import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createEffect, createSignal, on, type Accessor } from "solid-js"

const id = "internal:sandbox"

type Status = {
  directory: string
  enabled: boolean
  available: boolean
  reason?: string
  version: number
}

export function indicator(status?: Status) {
  return status?.enabled ? "◆ Sandbox on" : undefined
}

function session(api: TuiPluginApi) {
  if (api.route.current.name !== "session") return
  const sessionID = api.route.current.params?.sessionID
  if (typeof sessionID !== "string") return
  return sessionID
}

async function ensureSession(api: TuiPluginApi) {
  const current = session(api)
  if (current) return current
  const result = await api.client.session.create({}, { throwOnError: true })
  const sessionID = result.data?.id
  if (sessionID) api.route.navigate("session", { sessionID })
  return sessionID
}

function View(props: {
  api: TuiPluginApi
  sessionID: string
  status: Accessor<ReadonlyMap<string, Status>>
  load: (sessionID: string, force?: boolean) => Promise<void>
}) {
  createEffect(
    on(
      () => props.api.state.config.experimental?.sandbox,
      () => void props.load(props.sessionID, true),
    ),
  )
  return (
    <box flexShrink={0}>
      <text fg={props.api.theme.current.success}>{indicator(props.status().get(props.sessionID)) ?? ""}</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  const [status, setStatus] = createSignal<ReadonlyMap<string, Status>>(new Map())
  const pending = new Set<string>()
  const loads = new Map<string, symbol>()
  const commit = (sessionID: string, value: Status) => {
    const next = new Map(status())
    next.set(sessionID, value)
    setStatus(next)
  }
  const set = (sessionID: string, value: Status) => {
    loads.delete(sessionID)
    commit(sessionID, value)
  }
  const load = async (sessionID: string, force = false) => {
    if (!force && status().has(sessionID)) return
    const token = Symbol()
    loads.set(sessionID, token)
    try {
      const result = await api.client.sandbox.status({ sessionID }, { throwOnError: true })
      if (result.data && loads.get(sessionID) === token) commit(sessionID, result.data)
    } catch (err) {
      api.ui.toast({ message: String(err), variant: "error", duration: 5000 })
    } finally {
      if (loads.get(sessionID) === token) loads.delete(sessionID)
    }
  }
  const changed = api.event.on("sandbox.status.changed", (event) => set(event.properties.sessionID, event.properties))
  api.lifecycle.onDispose(changed)

  api.keymap.registerLayer({
    commands: [
      {
        namespace: "palette",
        name: "session.toggle.sandbox",
        title: "Toggle sandbox",
        category: "Session",
        slashName: "sandbox",
        async run() {
          const sessionID = await ensureSession(api)
          if (!sessionID || pending.has(sessionID)) return
          pending.add(sessionID)
          try {
            const result = await api.client.sandbox.toggle({ sessionID }, { throwOnError: true })
            const value = result.data
            if (!value) return
            set(sessionID, value)
            if (!value.enabled && !value.available) {
              api.ui.toast({
                message: value.reason ?? "Sandbox backend is unavailable",
                variant: "error",
                duration: 5000,
              })
              return
            }
            api.ui.toast({ message: `Sandbox ${value.enabled ? "enabled" : "disabled"}`, variant: "success" })
            api.ui.dialog.clear()
          } catch (err) {
            api.ui.toast({ message: String(err), variant: "error", duration: 5000 })
          } finally {
            pending.delete(sessionID)
          }
        },
      },
    ],
  })

  api.slots.register({
    order: 50,
    slots: {
      session_prompt_right(_ctx, props) {
        return <View api={api} sessionID={props.session_id} status={status} load={load} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = { id, tui }

export default plugin
