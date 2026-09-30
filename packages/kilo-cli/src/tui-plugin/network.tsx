import { createClient } from "@kilocode/client"
import type { RpcClient } from "@opencode-ai/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { NetworkRpc, type NetworkWait } from "@opencode-ai/schema/kilocode/network"
import { createEffect, createMemo, createSignal, on, onCleanup, Show, type Accessor } from "solid-js"

export type NetworkUiOptions = {
  readonly client?: Pick<ReturnType<typeof createClient>, "rpc">
  readonly signal?: AbortSignal
}

/** Shows the Kilo network wait above the composer of the session it holds. */
export function installNetworkUi(ctx: Plugin.Context, options: NetworkUiOptions) {
  const rpc: RpcClient<typeof NetworkRpc> | undefined = options.client?.rpc(NetworkRpc)
  if (!rpc) return
  const [waits, setWaits] = createSignal<ReadonlyMap<string, NetworkWait>>(new Map())
  const upsert = (wait: NetworkWait) => {
    setWaits((previous) => new Map(previous).set(wait.id, wait))
  }
  const events = { signal: options.signal }
  rpc.events.on("asked", (event) => upsert(event.data), events)
  rpc.events.on("restored", (event) => upsert(event.data), events)
  rpc.events.on(
    "resolved",
    (event) => {
      setWaits((previous) => {
        const next = new Map(previous)
        next.delete(event.data.id)
        return next
      })
    },
    events,
  )
  ctx.ui.slot({
    append: "session.composer.top",
    render: (props) => (
      <NetworkPanel
        context={ctx}
        sessionID={props.sessionID}
        rpc={rpc}
        waits={waits}
        upsert={upsert}
        signal={options.signal}
      />
    ),
  })
}

export function NetworkPanel(props: {
  readonly context: Plugin.Context
  readonly sessionID: string
  readonly rpc: RpcClient<typeof NetworkRpc>
  readonly waits: Accessor<ReadonlyMap<string, NetworkWait>>
  readonly upsert: (wait: NetworkWait) => void
  readonly signal?: AbortSignal
}) {
  const location = createMemo(() => props.context.data.session.get(props.sessionID)?.location)
  const wait = createMemo(() => Array.from(props.waits().values()).find((item) => item.sessionID === props.sessionID))
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 250)
  onCleanup(() => clearInterval(timer))
  // Resample on every update so a fresh deadline is never measured against a stale tick.
  createEffect(on(wait, () => setNow(Date.now())))
  const seconds = createMemo(() => {
    const resume = wait()?.time.resume
    if (resume === undefined) return 0
    return Math.max(0, Math.ceil((resume - now()) / 1000))
  })

  // Waits that started before this view attached are only visible through the list.
  createEffect(
    on(
      () => `${props.sessionID}\u0000${location()?.directory ?? ""}\u0000${location()?.workspaceID ?? ""}`,
      () => {
        const ref = location()
        if (!ref) return
        props.rpc
          .list({}, { location: ref, signal: props.signal })
          .then((result) =>
            result.waits.filter((item) => item.sessionID === props.sessionID).forEach((item) => props.upsert(item)),
          )
          .catch(() => undefined)
      },
    ),
  )

  props.context.keymap.layer(() => ({
    mode: "global",
    priority: 3,
    enabled: () => wait()?.restored === true,
    commands: [
      {
        bind: "return",
        title: "Resume now",
        group: "Network",
        run: () => {
          const current = wait()
          const ref = location()
          if (!current || !ref) return false
          void props.rpc.resume({ id: current.id }, { location: ref }).catch(() => undefined)
        },
      },
    ],
  }))

  const feedback = props.context.theme.text.feedback
  const tone = props.context.theme.text
  return (
    <Show when={wait()}>
      {(current) => (
        <box
          border={["left"]}
          borderColor={current().restored ? feedback.success.default : feedback.warning.default}
          backgroundColor={props.context.theme.background.surface.offset}
          paddingLeft={1}
          paddingRight={1}
          marginBottom={1}
        >
          <Show
            when={current().restored}
            fallback={
              <>
                <text fg={feedback.warning.default}>Network disconnected</text>
                <text fg={tone.default}>{current().message}</text>
                <text fg={tone.subdued}>Waiting for network… Press Esc twice to stop this turn.</text>
              </>
            }
          >
            <text fg={feedback.success.default}>Network reconnected</text>
            <text fg={tone.default}>Connection restored. Retrying in {seconds()}s.</text>
            <text fg={tone.subdued}>Press Enter to resume now, or Esc twice to stop.</text>
          </Show>
        </box>
      )}
    </Show>
  )
}
