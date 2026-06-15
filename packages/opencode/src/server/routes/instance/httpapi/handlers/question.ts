import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi" // kilocode_change - map Question missing requests to declared 404 errors
import { InstanceHttpApi } from "../api"

export const questionHandlers = HttpApiBuilder.group(InstanceHttpApi, "question", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Question.Service

    const list = Effect.fn("QuestionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("QuestionHttpApi.reply")(function* (ctx: {
      params: { requestID: QuestionID }
      payload: Question.Reply
    }) {
      // kilocode_change start - map missing Question requests to the declared transport error
      yield* svc
        .reply({
          requestID: ctx.params.requestID,
          answers: ctx.payload.answers,
        })
        .pipe(Effect.mapError(() => new HttpApiError.NotFound({})))
      // kilocode_change end
      return true
    })

    const reject = Effect.fn("QuestionHttpApi.reject")(function* (ctx: { params: { requestID: QuestionID } }) {
      // kilocode_change start - map missing Question requests to the declared transport error
      yield* svc.reject(ctx.params.requestID).pipe(Effect.mapError(() => new HttpApiError.NotFound({})))
      // kilocode_change end
      return true
    })

    return handlers.handle("list", list).handle("reply", reply).handle("reject", reject)
  }),
)
