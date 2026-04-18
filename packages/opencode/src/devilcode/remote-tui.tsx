/**
 * Remote Session Relay TUI indicator
 *
 * RemoteIndicator component for the footer status bar.
 */

import { createSignal, onMount, onCleanup, Show } from "solid-js"
import { Log } from "@/util/log"

// devilcode_change - audit N3: log polling failures instead of swallowing them silently.
const log = Log.create({ service: "remote-tui" })

/**
 * Footer indicator showing remote connection status.
 * Polls every 5 seconds. Only renders when kilo gateway is connected and remote is enabled.
 */
export function RemoteIndicator(props: { sdk: any; theme: any; kilo: boolean }) {
  const [status, setStatus] = createSignal<{
    enabled: boolean
    connected: boolean
  } | null>(null)

  onMount(() => {
    const poll = async () => {
      const res = await props.sdk.client.remote.status().catch((err: unknown) => {
        log.warn("remote.status.failed", { error: err instanceof Error ? err.message : String(err) })
        return null
      })
      if (res?.data) setStatus(res.data)
    }
    poll()
    const timer = setInterval(poll, 5000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={props.kilo && status()?.enabled}>
      <text fg={status()?.connected ? props.theme.success : props.theme.warning}>
        ◆ Remote{status()?.connected ? "" : " …"}
      </text>
    </Show>
  )
}
