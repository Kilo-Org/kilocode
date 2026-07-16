import type { Exit } from "@/cli/cmd/tui/context/exit"
import { RemoteExitRpc } from "@/cli/cmd/tui/remote-exit-rpc"
import { withTimeout } from "@/util/timeout"

export type RemoteExitBridgeClient = {
  on: (event: string, handler: () => void) => () => void
  call: (method: "tuiReady" | "tuiGone", input: undefined) => Promise<unknown>
}

export function createParentRemoteExitBridge(client: RemoteExitBridgeClient, exit: Exit) {
  const unsubscribe = client.on(RemoteExitRpc.Event, () => {
    void exit()
  })
  let disposed = false

  return {
    ready() {
      return client.call("tuiReady", undefined)
    },
    async dispose(timeoutMs = 5_000) {
      if (disposed) return
      disposed = true
      try {
        await withTimeout(client.call("tuiGone", undefined), timeoutMs, "remote exit cleanup timed out")
      } finally {
        unsubscribe()
      }
    },
  }
}
