import { RemoteExitRpc } from "@/kilocode/cli/cmd/tui/remote-exit-rpc"
import { RemoteExit } from "@/kilo-sessions/remote-exit"

export function createWorkerRemoteExit(emit: (event: string, data: undefined) => void) {
  let unregister: (() => void) | undefined

  const gone = () => {
    unregister?.()
    unregister = undefined
  }

  return {
    ready() {
      gone()
      unregister = RemoteExit.register(async () => {
        emit(RemoteExitRpc.Event, undefined)
      })
    },
    gone,
    shutdown: gone,
  }
}
