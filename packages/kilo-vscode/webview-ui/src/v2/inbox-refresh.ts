import { ClientError } from "@opencode/client"
import { retry } from "@opencode/util/retry"
import { createSignal, onCleanup } from "solid-js"
import { toFailure, type Failure } from "./error"

/** The queued-prompt snapshot is independent of the transcript and the live event stream. */
export function createInboxRefresh(read: (sessionID: string) => Promise<void>) {
  const [failure, setFailure] = createSignal<Failure>()
  return {
    failure,
    dismiss: () => setFailure(undefined),
    // Called once per session-view effect. An old tab or connection must not retry or publish a late failure.
    sync(sessionID: string) {
      let active = true
      onCleanup(() => {
        active = false
        setFailure(undefined)
      })
      return retry(() => (active ? read(sessionID) : Promise.resolve()), {
        retryIf: (error) => active && isTransport(error),
      }).then(
        () => {
          if (active) setFailure(undefined)
        },
        (error: unknown) => {
          if (!active) return
          if (!isTransport(error)) throw error
          setFailure(toFailure(error))
        },
      )
    },
  }
}

function isTransport(error: unknown) {
  return error instanceof ClientError && error.reason === "Transport"
}
