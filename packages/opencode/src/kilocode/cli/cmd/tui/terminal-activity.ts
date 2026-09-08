import type { Event, EventSessionTurnClose } from "@kilocode/sdk/v2"
import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { KiloTerminalTitle } from "./terminal-title"

type Outcome = EventSessionTurnClose["properties"]["reason"]

type Message = {
  id: string
  role: string
  error?: { name: string }
  finish?: string
}

export namespace KiloTerminalActivity {
  export type State = "idle" | "busy" | "retry" | "waiting" | "error" | "done"

  export type Data = Omit<KiloTerminalTitle.Data, "message"> & {
    message: Record<string, readonly Message[] | undefined>
  }

  export function classify(input: { id?: string; data: Data; outcomes?: Record<string, Outcome | undefined> }): State {
    if (!input.id) return "idle"
    const root = KiloTerminalTitle.root(input.data.session, input.id)
    const ids = [...new Set([root, ...KiloTerminalTitle.family(input.data.session, root)])]
    if (ids.some((id) => KiloTerminalTitle.attention(input.data, id))) return "waiting"
    if (ids.some((id) => input.data.session_status[id]?.type === "retry")) return "retry"
    if (ids.some((id) => input.data.session_status[id]?.type === "busy")) return "busy"

    const outcome = input.outcomes?.[root]
    if (outcome === "error") return "error"
    if (outcome === "interrupted" || outcome === "superseded") return "idle"
    const message = input.data.message[root]?.at(-1)
    if (message?.role === "assistant") {
      if (message.error?.name === "MessageAbortedError") return "idle"
      if (message.error || message.finish === "error" || message.finish === "content-filter") return "error"
      if (message.finish && message.finish !== "stop") return "idle"
    }
    return outcome === "completed" ? "done" : "idle"
  }

  export function format(state: State, timestamp = Date.now()) {
    return `\x1b]777;kilo;activity;1;${state};${timestamp}\x07`
  }

  export function use(input: {
    enabled?: string
    session: () => string | undefined
    data: Data
    subscribe: (handler: (event: Event) => void) => () => void
    write: (data: string) => void
  }) {
    if (input.enabled !== "1") return
    const [outcomes, setOutcomes] = createStore<Record<string, Outcome | undefined>>({})
    const off = input.subscribe((event) => {
      if (
        event.type === "session.turn.open" ||
        (event.type === "session.status" &&
          (event.properties.status.type === "busy" || event.properties.status.type === "retry"))
      ) {
        setOutcomes(event.properties.sessionID, undefined)
      }
      if (event.type === "session.turn.close") {
        setOutcomes(event.properties.sessionID, (prev) =>
          prev === "error" && event.properties.reason === "completed" ? prev : event.properties.reason,
        )
      }
      if (event.type === "session.error" && event.properties.sessionID) {
        setOutcomes(
          event.properties.sessionID,
          event.properties.error?.name === "MessageAbortedError" ? "interrupted" : "error",
        )
      }
    })
    const state = createMemo(() => classify({ id: input.session(), data: input.data, outcomes }))
    const send = () => input.write(format(state()))
    createEffect(send)
    const timer = setInterval(send, 5_000)
    onCleanup(() => {
      off()
      clearInterval(timer)
      input.write(format("idle"))
    })
  }
}
