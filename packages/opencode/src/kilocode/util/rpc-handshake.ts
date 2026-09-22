// kilocode_change - new file
/**
 * The worker installs its RPC handler only after its module graph loads, and messages posted
 * before that are dropped. The worker announces when it is ready; the client holds requests
 * until then, and rejects them if the worker dies first.
 */
export namespace KiloRpcHandshake {
  const READY = "rpc.ready"

  const LIMIT = 256

  export type Target = {
    postMessage: (data: string) => void | null
    onerror?: ((this: unknown, event: unknown) => unknown) | null
  }

  interface Held {
    message: string
    fail: (error: Error) => void
  }

  export function announce(post: (data: string) => void) {
    post(JSON.stringify({ type: READY }))
  }

  export function gate(target: Target) {
    let ready = false
    let held: Held[] = []

    const take = () => {
      const entries = held
      held = []
      return entries
    }

    // Chained: the caller may already have its own handler.
    const previous = target.onerror
    target.onerror = function (event: unknown) {
      const error = new Error("rpc target failed before it installed its handler")
      for (const entry of take()) entry.fail(error)
      return previous?.call(this, event)
    }

    return {
      /** True if the message was the announcement. */
      accept(parsed: { type?: string }) {
        if (parsed.type !== READY) return false
        ready = true
        for (const entry of take()) target.postMessage(entry.message)
        return true
      },
      send(message: string, fail: (error: Error) => void) {
        if (ready) {
          target.postMessage(message)
          return
        }
        if (held.length >= LIMIT) {
          fail(new Error(`rpc target has not installed its handler after ${LIMIT} held requests`))
          return
        }
        held.push({ message, fail })
      },
    }
  }
}
