// `/sandbox` toggles sandbox confinement of the current session's tools, and the prompt footer shows "◆ Sandbox on"
// while it is on. The state comes from the `kilocode.sandbox` RPC and its `changed` events.
import type { Plugin } from "@opencode/plugin/tui"
import { KiloSandboxRpc } from "@opencode/schema/kilocode/sandbox"
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"

type Status = KiloSandboxRpc.Status

type Location = { location: { directory: string } } | undefined

export function indicator(status?: Status) {
  return status?.enabled ? "◆ Sandbox on" : undefined
}

/**
 * Session sandbox state for the toggle command and the footer indicator. A status read that started before a toggle
 * reply or a `changed` event must not put the older value back, so every read owns a token.
 */
export function createSandboxStatus(input: {
  /** The directory the event-fed store knows for the session, once it knows the session. */
  stored: (sessionID: string) => string | undefined
  read: (sessionID: string, location: Location) => Promise<Status>
  write: (sessionID: string, location: Location) => Promise<Status>
}) {
  const [status, setStatus] = createSignal<ReadonlyMap<string, Status>>(new Map())
  const loads = new Map<string, symbol>()
  // A session created by `/sandbox` is not in the event-fed store yet; its RPC calls use the directory it was
  // created in until the store supplies the session.
  const [created, setCreated] = createSignal<ReadonlyMap<string, string>>(new Map())

  const location = (sessionID: string): Location => {
    const stored = input.stored(sessionID)
    if (stored) return { location: { directory: stored } }
    const directory = created().get(sessionID)
    return directory ? { location: { directory } } : undefined
  }

  const set = (sessionID: string, value: Status) => {
    loads.delete(sessionID)
    setStatus((current) => new Map(current).set(sessionID, value))
  }

  const load = (sessionID: string) => {
    const token = Symbol()
    loads.set(sessionID, token)
    return input.read(sessionID, location(sessionID)).then(
      (value) => {
        if (loads.get(sessionID) === token) set(sessionID, value)
      },
      () => {
        if (loads.get(sessionID) === token) loads.delete(sessionID)
      },
    )
  }

  return {
    status: (sessionID: string) => status().get(sessionID),
    load,
    set,
    remember(sessionID: string, directory: string) {
      setCreated((current) => new Map(current).set(sessionID, directory))
    },
    /** Drops a creation directory once the event-fed store supplies the session, so a move cannot reuse it. */
    forget() {
      const current = created()
      if (current.size === 0) return
      const keep = new Map([...current].filter(([sessionID]) => input.stored(sessionID) === undefined))
      if (keep.size !== current.size) setCreated(keep)
    },
    toggle(sessionID: string) {
      return input.write(sessionID, location(sessionID)).then((value) => {
        set(sessionID, value)
        return value
      })
    },
  }
}

export function sandbox(context: Plugin.Context) {
  const rpc = context.client.rpc(KiloSandboxRpc.Definition)
  const state = createSandboxStatus({
    stored: (sessionID) => context.data.session.get(sessionID)?.location.directory,
    read: (sessionID, location) => rpc.status({ sessionID }, location),
    write: (sessionID, location) => rpc.toggle({ sessionID }, location),
  })
  const pending = new Set<string>()

  const current = () => {
    const route = context.ui.router.current()
    return route.type === "session" ? route.sessionID : undefined
  }

  const ensure = async () => {
    const sessionID = current()
    if (sessionID) return sessionID
    const location = context.location ?? context.data.location.default()
    const session = await context.client.session.create({ location: { directory: location.directory } })
    state.remember(session.id, session.location.directory)
    context.ui.router.navigate({ type: "session", sessionID: session.id })
    return session.id
  }

  const toggle = async () => {
    const sessionID = await ensure().catch((error: unknown) => {
      context.ui.toast.show({ variant: "error", message: String(error), duration: 5000 })
      return undefined
    })
    if (!sessionID || pending.has(sessionID)) return
    pending.add(sessionID)
    try {
      const value = await state.toggle(sessionID)
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
      onCleanup(rpc.events.on("changed", (event) => state.set(event.data.sessionID, event.data)))
      createEffect(() => state.forget())
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
            if (sessionID) void state.load(sessionID)
          },
        ),
      )
      onCleanup(
        context.data.on("server.connected", () => {
          if (props.sessionID) void state.load(props.sessionID)
        }),
      )
      const label = () => (props.sessionID ? indicator(state.status(props.sessionID)) : undefined)
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
