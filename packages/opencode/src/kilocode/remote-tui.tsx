/**
 * Remote Session Relay TUI indicator
 *
 * RemoteIndicator component for the footer status bar.
 */

import type { Event } from "@kilocode/sdk/v2"
import { createSignal, onCleanup, onMount, Show } from "solid-js"

type Status = {
  enabled: boolean
  connected: boolean
}

/**
 * Footer indicator showing remote connection status.
 * Uses the TUI event stream after an initial status fetch.
 */
export function RemoteIndicator(props: {
  sdk: any
  theme: any
  kilo: boolean
  event: { on: <Type extends Event["type"]>(type: Type, handler: (event: Extract<Event, { type: Type }>) => void) => () => void }
}) {
  const [status, setStatus] = createSignal<Status | null>(null)

  onMount(() => {
    void props.sdk.client.remote
      .status()
      .then((res: { data?: Status }) => {
        if (res.data) setStatus(res.data)
      })
      .catch(() => undefined)
    const off = props.event.on("kilo-sessions.remote-status-changed", (evt) => setStatus(evt.properties))
    onCleanup(off)
  })

  return (
    <Show when={props.kilo && status()?.enabled}>
      <text fg={status()?.connected ? props.theme.success : props.theme.warning}>
        ◆ Remote{status()?.connected ? "" : " …"}
      </text>
    </Show>
  )
}
