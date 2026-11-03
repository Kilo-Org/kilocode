// Interrupts the busy sessions of the window server before the extension stops it. The window server exits when its
// stdin closes and never runs the restart sweep, so a turn cut by the stop would keep its execution claim, and the
// next managed-service start could resume it without the user.
import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { local } from "./local"
import type { Server } from "./server"

const LIMIT = 3_000

export function createShutdown(input: { log?: (text: string) => void; limit?: number } = {}) {
  const state: { server?: Server } = {}
  return {
    started(server: Server) {
      state.server = server
    },
    stopped() {
      state.server = undefined
    },
    /** Interrupts the active sessions of the running server, bounded by `limit`, then runs `stop`. */
    async run(stop: () => Promise<unknown> | undefined) {
      const server = state.server
      if (server) {
        const api = OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization }, fetch: local })
        const timer = new Promise<void>((resolve) => setTimeout(resolve, input.limit ?? LIMIT).unref())
        await Promise.race([interrupt(api, input.log), timer])
      }
      await stop()
    },
  }
}

async function interrupt(api: OpenCodeClient, log?: (text: string) => void) {
  const active = await api.session.active().catch((error: unknown) => {
    log?.(`Could not list active sessions before shutdown: ${String(error)}`)
    return {}
  })
  await Promise.all(
    Object.keys(active).map((sessionID) =>
      api.session
        .interrupt({ sessionID })
        .catch((error: unknown) => log?.(`Could not interrupt ${sessionID} before shutdown: ${String(error)}`)),
    ),
  )
}
