// kilocode_change - new file
/**
 * Ready-gate for the worker RPC channel.
 *
 * A worker installs its handler only after its whole module graph has evaluated, and the TUI's
 * worker imports the entire server — so the main process can reach its first request first. The
 * runtime drops anything posted before that point rather than queueing it, and `Rpc.client.call`
 * has neither a rejection path nor a timeout, so one lost request hangs the caller forever.
 *
 * The target announces its handler and the client holds requests until it sees that announcement.
 * Held requests are the gate's own state, so failing them is the gate's job too: a target that dies
 * before announcing would otherwise turn a dropped-and-hung request into a queued-and-hung one, and
 * the queue would keep growing for the life of the client.
 *
 * Lives here rather than in `util/rpc.ts` so the diff against upstream opencode stays a hook.
 */
export namespace KiloRpcHandshake {
  const READY = "rpc.ready"

  /** Ample for a startup burst; past this the target is not coming, and holding more only hides it. */
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

    // Chained, not replaced: the caller installs its own error logging before it builds the client.
    const previous = target.onerror
    target.onerror = function (event: unknown) {
      const error = new Error("rpc target failed before it installed its handler")
      for (const entry of take()) entry.fail(error)
      return previous?.call(this, event)
    }

    return {
      /** True when the message was the announcement itself and needs no further handling. */
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
