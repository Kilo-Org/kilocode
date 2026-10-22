import * as Log from "@opencode-ai/core/util/log"
import { Daemon } from "./daemon"

export namespace DaemonClient {
  const log = Log.create({ service: "daemon.client" })

  export type Connection = {
    url: string
    headers: Record<string, string>
    state: Daemon.State
  }

  export function enabled() {
    return !process.env.KILO_NO_DAEMON
  }

  export function headers(state: Daemon.State) {
    return { Authorization: `Basic ${state.token}` }
  }

  export async function connect(): Promise<Connection | undefined> {
    if (!enabled()) return undefined
    const daemon = await Daemon.status()
    if (!daemon.running || !daemon.state) return undefined
    return {
      url: daemon.state.url,
      headers: headers(daemon.state),
      state: daemon.state,
    }
  }

  export async function maybe(): Promise<Connection | undefined> {
    return await connect().catch((err) => {
      log.warn("daemon unavailable, falling back to embedded server", { err })
      return undefined
    })
  }
}
