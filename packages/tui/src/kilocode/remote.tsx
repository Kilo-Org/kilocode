import { Plugin } from "@opencode/plugin/tui"
import { KiloRemoteRpc } from "@opencode/schema/kilocode/remote"
import { createSignal, onCleanup, onMount, Show } from "solid-js"

export default Plugin.define({
  id: "kilocode.remote",
  setup(context) {
    const rpc = context.client.rpc(KiloRemoteRpc.Definition)
    const [status, setStatus] = createSignal<KiloRemoteRpc.Status>()
    const [pending, setPending] = createSignal(false)
    const options = () => ({ location: { directory: (context.location ?? context.data.location.default()).directory } })
    // A status read started before a toggle must not replace the toggle's newer result.
    let generation = 0
    const refresh = async () => {
      if (pending()) return
      const current = ++generation
      await rpc.status({}, options()).then(
        (value) => {
          if (current === generation) setStatus(value)
        },
        () => {
          if (current === generation) setStatus((value) => value && { ...value, connected: false })
        },
      )
    }
    const toggle = async () => {
      if (pending()) return
      setPending(true)
      generation++
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
          message: error instanceof Error ? error.message : String(error),
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
              description: "Allow or stop remote commands for this process",
              group: "Kilo",
              palette: true,
              slash: { name: "remote" },
              enabled: !pending(),
              run: toggle,
            },
          ],
        }))
        onMount(() => void refresh())
        const timer = setInterval(() => void refresh(), 5_000)
        onCleanup(() => {
          clearInterval(timer)
          generation++
        })
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
  },
})
