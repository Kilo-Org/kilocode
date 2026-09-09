import { Effect, Exit } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { PromptInput } from "@/session/prompt"
import type { MessageID, SessionID } from "@/session/schema"
import { KiloSessionPromptQueue } from "../prompt-queue"
import { GoalState } from "./state"

export namespace GoalPolicy {
  export type Report = { status: "complete" | "blocked"; reason: string }
  export type Owner = {
    root: SessionID
    report: (id: MessageID, report: Report) => boolean
    input: (input: PromptInput) => PromptInput
    fail: () => void
    current: () => boolean
  }
  const owners = new Map<MessageID, Owner>()

  export function track(id: MessageID, owner: Owner) {
    owners.set(id, owner)
  }

  export function release(id: MessageID, owner: Owner) {
    if (owners.get(id) === owner) owners.delete(id)
  }

  export function available(id: SessionID, tool: string) {
    if (tool === "goal_report") {
      const base = KiloSessionPromptQueue.active(id)
      const owner = base ? owners.get(base) : undefined
      return owner?.root === id && owner.current()
    }
    if (tool !== "question") return true
    if (GoalState.active(id)) return false
    const base = KiloSessionPromptQueue.active(id)
    return !base || !owners.get(base)?.current()
  }

  export function report(id: SessionID, message: MessageID, report: Report) {
    const base = KiloSessionPromptQueue.active(id)
    const owner = base ? owners.get(base) : undefined
    return owner?.root === id && owner.current() && owner.report(message, report)
  }

  export function bind<E, R>(id: SessionID, prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, E, R>) {
    const base = KiloSessionPromptQueue.active(id)
    const owner = base ? owners.get(base) : undefined
    if (!owner) return prompt
    return (input: PromptInput) =>
      Effect.suspend(() => prompt(owner.input(input))).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) || (exit.value.info.role === "assistant" && exit.value.info.error)
            ? Effect.sync(owner.fail)
            : Effect.void,
        ),
      )
  }
}
