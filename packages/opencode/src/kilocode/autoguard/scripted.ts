import { Effect } from "effect"
import type { Question } from "@/question"
import type { PendingApproval } from "./types"
import { canonical } from "./resources"

export interface GrantAnswer {
  operation: string
  target: string
  approved: boolean
}
export type ScriptedAnswer = GrantAnswer | { question_pattern: string; answer: string }

/** Host-authored text replies are consumed once and never become grants directly. */
export function clarification(question: string, rules: ScriptedAnswer[]): string | undefined {
  const index = rules.findIndex(
    (rule) => "question_pattern" in rule && new RegExp(rule.question_pattern, "iu").test(question),
  )
  if (index < 0) return
  const [rule] = rules.splice(index, 1)
  return "answer" in rule ? rule.answer : undefined
}
export function selection(request: PendingApproval, rules: ScriptedAnswer[], cwd: string): boolean | undefined {
  if (!request.candidates.length) return
  const choices = request.candidates.map(
    (g) =>
      (
        rules.find(
          (r) => "operation" in r && r.operation === g.operation && canonical(r.target, cwd) === g.resource.key,
        ) as GrantAnswer | undefined
      )?.approved,
  )
  if (choices.some((value) => value === undefined)) return
  return choices.every((value) => value === true)
}

/** A benchmark-only host responder still goes through the real Question service. */
export function respond(service: Question.Interface, session: string, call: string, approved: boolean | string) {
  return Effect.gen(function* () {
    const deadline = Date.now() + 5000
    for (;;) {
      const question = (yield* service.list()).find((q) => q.sessionID === session && q.tool?.callID === call)
      if (question) {
        yield* service.reply({
          requestID: question.id,
          answers: [[typeof approved === "string" ? approved : approved ? "Разрешить" : "Отказать"]],
        })
        return
      }
      if (Date.now() >= deadline) return yield* Effect.die(new Error("scripted_question_not_registered"))
      yield* Effect.sleep(5)
    }
  })
}

/** Observe the actual native Question registration, including baseline questions. */
export function observeQuestion(
  service: Question.Interface,
  session: string,
  call: string,
  rules: ScriptedAnswer[],
  pending: (id: string) => void,
  answered: (id: string, answer: string) => Promise<void>,
) {
  return Effect.gen(function* () {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const question = (yield* service.list()).find((q) => q.sessionID === session && q.tool?.callID === call)
      if (question) {
        pending(question.id)
        if (question.questions.length !== 1) return
        const answer = clarification(question.questions[0].question, rules)
        if (answer === undefined) return
        yield* service.reply({ requestID: question.id, answers: [[answer]] })
        yield* Effect.promise(() => answered(question.id, answer))
        return
      }
      yield* Effect.sleep(5)
    }
  }).pipe(Effect.orDie)
}
