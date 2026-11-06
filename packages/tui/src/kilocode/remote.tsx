import { Plugin } from "@opencode/plugin/tui"
import { KiloRemoteRpc } from "@opencode/schema/kilocode/remote"
import { createEffect, createRoot, createSignal, on, onCleanup, Show } from "solid-js"
import { errorMessage } from "../util/error"

export default Plugin.define({
  id: "kilocode.remote",
  setup(context) {
    const rpc = context.client.rpc(KiloRemoteRpc.Definition)
    const [status, setStatus] = createSignal<KiloRemoteRpc.Status>()
    const [pending, setPending] = createSignal(false)
    // The launch workspace stays fixed when a restored session routes to a child directory.
    const directory = context.data.location.default().directory
    const options = () => ({ location: { directory } })
    const sessionID = () => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }
    let attached: string | undefined
    // A status read started before a toggle must not replace the toggle's newer result.
    let generation = 0
    let inflight: AbortController | undefined
    const refresh = async () => {
      if (pending() || inflight) return
      const controller = new AbortController()
      inflight = controller
      const current = ++generation
      const restored = sessionID()
      try {
        const request = {
          ...options(),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        }
        const value =
          restored && restored !== attached
            ? await rpc.attach({ sessionID: restored }, request)
            : await rpc.status({}, request)
        if (restored) attached = restored
        if (current === generation) setStatus(value)
      } catch {
        if (current === generation) setStatus((value) => value && { ...value, connected: false })
      } finally {
        if (inflight === controller) inflight = undefined
        // Navigation can finish while an earlier status request is in flight.
        if (sessionID() !== restored) void refresh()
      }
    }
    const toggle = async () => {
      if (pending()) return
      setPending(true)
      generation++
      inflight?.abort()
      try {
        const current = await rpc.status({}, options())
        const next = await (current.enabled ? rpc.disable({}, options()) : rpc.enable({}, options()))
        setStatus(next)
        context.ui.toast.show({
          variant: next.enabled && !next.connected ? "warning" : "info",
          message: next.enabled
            ? next.connected
              ? "Remote control enabled"
              : "Remote control enabled; waiting for connection"
            : "Remote control disabled",
        })
      } catch (error) {
        context.ui.toast.show({
          variant: "error",
          title: "Remote control",
          message: errorMessage(error),
        })
      } finally {
        setPending(false)
      }
    }

    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "kilo.remote",
              title: "Toggle remote control",
              description: "Allow or stop remote commands for this workspace",
              group: "Kilo",
              palette: true,
              slash: { name: "remote" },
              enabled: !pending(),
              run: toggle,
            },
          ],
        }))
        return null
      },
    })
    context.ui.slot({
      append: "app.header",
      render: () => (
        <Show when={status()?.enabled}>
          <box flexDirection="row" justifyContent="flex-end" paddingX={1} height={1} flexShrink={0}>
            <text
              fg={
                status()?.connected
                  ? context.theme.text.feedback.success.base
                  : context.theme.text.feedback.warning.base
              }
            >
              {status()?.connected ? "● Remote control" : "○ Remote control · disconnected"}
            </text>
          </box>
        </Show>
      ),
    })
    // Restoring ownership is a plugin lifecycle operation, not a view effect.
    // A lazily loading session route must not delay the runner announcement.
    return createRoot((dispose) => {
      createEffect(on(sessionID, () => void refresh()))
      onCleanup(
        context.data.on("server.connected", () => {
          attached = undefined
          void refresh()
        }),
      )
      const timer = setInterval(() => void refresh(), 5_000)
      onCleanup(() => {
        clearInterval(timer)
        generation++
        inflight?.abort()
      })
      return dispose
    })
  },
})
