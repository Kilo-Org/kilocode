// kilocode_change - new file
import type { Bus } from "@/bus"
import { AgentManagerEvent } from "@/kilocode/agent-manager/event"
import type { SessionID } from "@/session/schema"
import type { DeepMutable } from "@/util/schema"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { Effect, Schema } from "effect"

const TIMEOUT_MS = 15_000

interface Pending {
  resolve(output: string): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
  cleanup(): void
}

export interface InspectResponse {
  requestID: string
  output?: string
  error?: string
}

type Response = DeepMutable<typeof AgentManagerInspectBridge.Response.Type>

export namespace AgentManagerInspectBridge {
  const pending = new Map<string, Pending>()

  export const Response = Schema.Struct({
    requestID: Schema.String,
    output: Schema.optional(Schema.String),
    error: Schema.optional(Schema.String),
  }).pipe(withStatics((s) => ({ zod: zod(s) })))

  function drop(requestID: string) {
    const item = pending.get(requestID)
    if (!item) return
    pending.delete(requestID)
    clearTimeout(item.timeout)
    item.cleanup()
  }

  export function respond(input: Response): boolean {
    const item = pending.get(input.requestID)
    if (!item) return false
    drop(input.requestID)
    if (input.error) {
      item.reject(new Error(input.error))
      return true
    }
    item.resolve(input.output ?? "")
    return true
  }

  export function request(
    bus: Bus.Interface,
    input: {
      requestID: string
      sessionID: SessionID
      targetSessionID: string
      tail?: number
      abort: AbortSignal
    },
  ) {
    return Effect.gen(function* () {
      const wait = new Promise<string>((resolve, reject) => {
        const abort = () => {
          drop(input.requestID)
          reject(new Error("Agent Manager inspect request was aborted"))
        }
        const timeout = setTimeout(() => {
          drop(input.requestID)
          reject(new Error("Timed out waiting for the VS Code extension to inspect Agent Manager"))
        }, TIMEOUT_MS)
        input.abort.addEventListener("abort", abort, { once: true })
        pending.set(input.requestID, {
          resolve,
          reject,
          timeout,
          cleanup: () => input.abort.removeEventListener("abort", abort),
        })
      })

      yield* bus.publish(AgentManagerEvent.Inspect, {
        requestID: input.requestID,
        sessionID: input.sessionID,
        targetSessionID: input.targetSessionID,
        ...(input.tail ? { tail: input.tail } : {}),
      })

      return yield* Effect.promise(() => wait)
    })
  }
}
