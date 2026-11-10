export * as KiloRunDrain from "./run-drain"

import { runNonInteractivePrompt } from "@opencode/cli/run/noninteractive"
import { errorMessage } from "@opencode/cli/util/error"
import { KiloSessionDrainRpc } from "@opencode/schema/kilocode/session-drain"

export type Input = Parameters<typeof runNonInteractivePrompt>[0]

const DRAINED = "rpc.kilocode.session-drain.drained"

/**
 * The prompt step of `kilo2 run`, then the session drain: after the reply, the run exits only once the session and
 * everything it started have gone quiet on the server. An interruption of the session while it drains fails the run.
 * The host entry ends stdout and stderr before the process exits, so nothing printed here is lost.
 */
export async function prompt(input: Input) {
  await runNonInteractivePrompt(input)
  if (input.signal.aborted) return
  // The run reports a thrown error and exits nonzero.
  await wait(input).catch((error: unknown) => {
    if (input.signal.aborted) return
    throw new Error(failure(error))
  })
}

/**
 * Calls `kilocode.session-drain` with a fresh token and resolves once the call succeeded and the matching `drained`
 * event arrived on the event stream, which then carried every earlier event of the session. Rejects when the stream
 * ends, the root session is interrupted, or the run is aborted (the session is then interrupted, as upstream does
 * when a run is cancelled).
 */
export async function wait(input: Pick<Input, "client" | "sessionID" | "location" | "signal">) {
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, input.signal])
  const token = crypto.randomUUID()
  const abort = () => void input.client.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
  input.signal.addEventListener("abort", abort, { once: true })
  // Subscribe before the call, so neither the acknowledgment nor an interruption can pass unseen.
  const stream = input.client.event.subscribe({ signal })[Symbol.asyncIterator]()
  try {
    if ((await stream.next()).done) throw new Error("Event stream disconnected before the session drained")
    const acknowledged = (async () => {
      while (true) {
        const next = await stream.next()
        if (next.done) throw new Error("Event stream disconnected before the session drained")
        const event = next.value
        if (
          event.type === "session.execution.interrupted" &&
          event.data.sessionID === input.sessionID &&
          event.data.reason !== "superseded"
        )
          throw new Error(`Session interrupted: ${event.data.reason}`)
        if (event.type === DRAINED && event.data.sessionID === input.sessionID && event.data.token === token) return
      }
    })()
    const called = input.client
      .rpc(KiloSessionDrainRpc.Definition)
      .drain({ sessionID: input.sessionID, token }, { location: input.location, signal })
      .then((drained) => {
        if (drained !== true) throw new Error("Server did not acknowledge session completion")
      })
    await Promise.all([called, acknowledged])
  } finally {
    input.signal.removeEventListener("abort", abort)
    controller.abort()
    void stream.return?.(undefined).catch(() => {})
  }
}

function failure(error: unknown) {
  if (typeof error === "object" && error !== null && "type" in error && error.type === "rpc.unavailable")
    return "Server does not support session draining; upgrade or restart the server"
  return errorMessage(error)
}
