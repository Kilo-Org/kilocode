// kilocode_change - new file
import type { SessionID } from "@/session/schema"
import { Bus } from "@/bus"
import { Session } from "@/session"

export namespace BackgroundTaskStartAck {
  export function wait(opts: { sessionID: SessionID; signal?: AbortSignal }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"))
        return
      }

      let done = false
      let unsub = () => {}

      unsub = Bus.subscribe(Session.Event.TurnOpen, (evt) => {
        if (done) return
        if (evt.properties.sessionID !== opts.sessionID) return
        settle(() => resolve())
      })

      const onAbort = () => {
        if (done) return
        settle(() => reject(new DOMException("Aborted", "AbortError")))
      }

      opts.signal?.addEventListener("abort", onAbort, { once: true })

      if (opts.signal?.aborted) {
        settle(() => reject(new DOMException("Aborted", "AbortError")))
      }

      function settle(apply: () => void) {
        if (done) return
        done = true
        unsub()
        opts.signal?.removeEventListener("abort", onAbort)
        apply()
      }
    })
  }
}
