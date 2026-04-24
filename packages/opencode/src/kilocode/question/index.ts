import { Deferred, Effect } from "effect"
import { InstanceState } from "@/effect"
import { Log } from "@/util"
import { SessionID } from "@/session/schema"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"

/**
 * Kilo-specific helpers for the shared `@/question` module.
 *
 * Extracted here so the upstream file keeps just the import, an Interface entry
 * for `dismissAll`, and one-liner calls at the use sites — minimising the
 * surface area that conflicts with upstream.
 */
export namespace KiloQuestion {
  const log = Log.create({ service: "question" })

  /** Minimal entry shape both helpers need; matches `PendingEntry` in `@/question`. */
  type Entry = {
    info: { id: unknown; sessionID: SessionID }
    deferred: Deferred.Deferred<any, any>
  }

  /**
   * Factory for `Question.dismissAll`: dismisses every pending question on a
   * session so a new prompt can unblock an in-flight tool waiting on user
   * input. Mirrors `Suggestion.dismissAll` so both read the same way at the
   * callsite.
   *
   * The caller provides a `publishRejected` callback (closed over the already-
   * resolved `Bus.Service` in the Question layer) and an error factory so this
   * helper stays free of any `@/question` import and dodges a circular dep.
   */
  export const makeDismissAll =
    <ID, PE extends Entry>(args: {
      state: InstanceState.InstanceState<{ pending: Map<ID, PE> }>
      publishRejected: (entry: PE) => Effect.Effect<void>
      makeError: () => PE["deferred"] extends Deferred.Deferred<any, infer E> ? E : never
    }) =>
    (sessionID: SessionID) =>
      Effect.gen(function* () {
        const pending = (yield* InstanceState.get(args.state)).pending
        for (const [id, entry] of Array.from(pending.entries())) {
          if (entry.info.sessionID !== sessionID) continue
          pending.delete(id)
          log.info("dismissed", { requestID: id })
          yield* args.publishRejected(entry)
          yield* Deferred.fail(entry.deferred, args.makeError())
        }
      })

  /**
   * Auto-dismiss when a newer prompt is already queued on this session — a
   * tool that calls `Question.ask` after the queue event would otherwise block
   * the run while the user waits for their queued prompt to take over.
   */
  export const guardFollowup = <E>(sessionID: SessionID, makeError: () => E) =>
    Effect.gen(function* () {
      if (!KiloSessionPromptQueue.hasFollowup(sessionID)) return
      log.info("auto-dismissed — followup queued", { sessionID })
      return yield* Effect.fail(makeError())
    })
}
