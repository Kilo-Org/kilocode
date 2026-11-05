// `/sandbox` toggles sandbox confinement of the current session's tools, and the prompt footer shows "◆ Sandbox on"
// while it is on. The state comes from the `kilocode.sandbox` RPC and its `changed` events.
import type { Plugin } from "@opencode/plugin/tui"
import { KiloSandboxRpc } from "@opencode/schema/kilocode/sandbox"
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"

type Status = KiloSandboxRpc.Status

export function indicator(status?: Status) {
  return status?.enabled ? "◆ Sandbox on" : undefined
}

export function sandbox(context: Plugin.Context) {
  const rpc = context.client.rpc(KiloSandboxRpc.Definition)
  const [status, setStatus] = createSignal<ReadonlyMap<string, Status>>(new Map())
  const pending = new Set<string>()
  const set = (sessionID: string, value: Status) => {
    setStatus((current) => new Map(current).set(sessionID, value))
  }
  const options = (sessionID: string) => {
    const directory = context.data.session.get(sessionID)?.location.directory
    return directory ? { location: { directory } } : undefined
  }
  const load = (sessionID: string) =>
    rpc.status({ sessionID }, options(sessionID)).then(
      (value) => set(sessionID, value),
      () => undefined,
    )

  const current = () => {
    const route = context.ui.router.current()
    return route.type === "session" ? route.sessionID : undefined
  }

  const ensure = async () => {
    const sessionID = current()
    if (sessionID) return sessionID
    const location = context.location ?? context.data.location.default()
    const created = await context.client.session.create({ location: { directory: location.directory } })
    context.ui.router.navigate({ type: "session", sessionID: created.id })
    return created.id
  }

  const toggle = async () => {
    const sessionID = await ensure().catch((error: unknown) => {
      context.ui.toast.show({ variant: "error", message: String(error), duration: 5000 })
      return undefined
    })
    if (!sessionID || pending.has(sessionID)) return
    pending.add(sessionID)
    try {
      const value = await rpc.toggle({ sessionID }, options(sessionID))
      set(sessionID, value)
      if (!value.enabled && !value.available) {
        context.ui.toast.show({
          variant: "error",
          message: value.reason ?? "Sandbox backend is unavailable",
          duration: 5000,
        })
        return
      }
      context.ui.toast.show({ variant: "success", message: `Sandbox ${value.enabled ? "enabled" : "disabled"}` })
    } catch (error) {
      context.ui.toast.show({ variant: "error", message: message(error), duration: 5000 })
    } finally {
      pending.delete(sessionID)
    }
  }

  context.ui.slot({
    append: "app",
    render() {
      onCleanup(rpc.events.on("changed", (event) => set(event.data.sessionID, event.data)))
      context.keymap.layer(() => ({
        mode: "global",
        commands: [
          {
            id: "kilo.sandbox.toggle",
            title: "Toggle sandbox",
            description: "Confine this session's shell commands, file writes and network access",
            group: "Session",
            palette: true,
            slash: { name: "sandbox" },
            run: () => void toggle(),
          },
        ],
      }))
      return null
    },
  })

  context.ui.slot({
    append: "prompt.footer.status",
    render: (props) => {
      createEffect(
        on(
          () => props.sessionID,
          (sessionID) => {
            if (sessionID) void load(sessionID)
          },
        ),
      )
      onCleanup(
        context.data.on("server.connected", () => {
          if (props.sessionID) void load(props.sessionID)
        }),
      )
      const label = () => (props.sessionID ? indicator(status().get(props.sessionID)) : undefined)
      return (
        <Show when={label()}>
          {(text) => (
            <box flexShrink={0}>
              <text fg={context.theme.text.feedback.success.base}>{text()}</text>
            </box>
          )}
        </Show>
      )
    },
  })
}

function message(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string")
    return error.message
  return String(error)
}
