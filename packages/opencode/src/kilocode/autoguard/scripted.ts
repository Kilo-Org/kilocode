import { Effect } from "effect"
import type { Question } from "@/question"
import type { PendingApproval } from "./types"
import { canonical } from "./resources"

export interface ScriptedAnswer {
  operation: string
  target: string
  approved: boolean
}
export function selection(request: PendingApproval, rules: ScriptedAnswer[], cwd: string): boolean | undefined {
  if (!request.candidates.length) return
  const choices = request.candidates.map(
    (g) => rules.find((r) => r.operation === g.operation && canonical(r.target, cwd) === g.resource.key)?.approved,
  )
  if (choices.some((value) => value === undefined)) return
  return choices.every((value) => value === true)
}

/** A benchmark-only host responder still goes through the real Question service. */
export function respond(service: Question.Interface, session: string, call: string, approved: boolean) {
  return Effect.gen(function* () {
    const deadline = Date.now() + 5000
    for (;;) {
      const question = (yield* service.list()).find((q) => q.sessionID === session && q.tool?.callID === call)
      if (question) {
        yield* service.reply({ requestID: question.id, answers: [[approved ? "Разрешить" : "Отказать"]] })
        return
      }
      if (Date.now() >= deadline) return yield* Effect.die(new Error("scripted_question_not_registered"))
      yield* Effect.sleep(5)
    }
  })
}
