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
  resolve(output: Response): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
  cleanup(): void
}

export namespace AgentManagerControlBridge {
  const pending = new Map<string, Pending>()

  export const Response = Schema.Struct({
    requestID: Schema.String,
    action: Schema.String,
    applied: Schema.Boolean,
    message: Schema.String,
    sessionID: Schema.optional(Schema.String),
    worktreeID: Schema.optional(Schema.String),
    sectionID: Schema.optional(Schema.String),
  }).pipe(withStatics((s) => ({ zod: zod(s) })))

  export type Response = DeepMutable<typeof Response.Type>

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
    item.resolve(input)
    return true
  }

  export function format(input: Response): string {
    return [
      `action: ${input.action}`,
      `applied: ${input.applied}`,
      `message: ${input.message}`,
      ...(input.sessionID ? [`session_id: ${input.sessionID}`] : []),
      ...(input.worktreeID ? [`worktree_id: ${input.worktreeID}`] : []),
      ...(input.sectionID ? [`section_id: ${input.sectionID}`] : []),
    ].join("\n")
  }

  export function request(
    bus: Bus.Interface,
    input: {
      requestID: string
      sessionID: SessionID
      action: "prompt" | "stop" | "create_section" | "rename_section" | "remove_section" | "move_to_section" | "ungroup"
      targetSessionID?: string
      prompt?: string
      worktreeID?: string
      sectionID?: string
      sectionName?: string
      newSectionName?: string
      color?: string
      createIfMissing?: boolean
      abort: AbortSignal
    },
  ) {
    return Effect.gen(function* () {
      const wait = new Promise<Response>((resolve, reject) => {
        const abort = () => {
          drop(input.requestID)
          reject(new Error("Agent Manager control request was aborted"))
        }
        const timeout = setTimeout(() => {
          drop(input.requestID)
          reject(new Error("Timed out waiting for the VS Code extension to apply Agent Manager control"))
        }, TIMEOUT_MS)
        input.abort.addEventListener("abort", abort, { once: true })
        pending.set(input.requestID, {
          resolve,
          reject,
          timeout,
          cleanup: () => input.abort.removeEventListener("abort", abort),
        })
      })

      yield* bus.publish(AgentManagerEvent.Control, {
        requestID: input.requestID,
        sessionID: input.sessionID,
        action: input.action,
        targetSessionID: input.targetSessionID,
        prompt: input.prompt,
        worktreeID: input.worktreeID,
        sectionID: input.sectionID,
        sectionName: input.sectionName,
        newSectionName: input.newSectionName,
        color: input.color,
        createIfMissing: input.createIfMissing,
      })

      return yield* Effect.promise(() => wait)
    })
  }
}
