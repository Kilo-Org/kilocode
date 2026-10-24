import { Instance, provide } from "@/kilocode/instance"
import { InstanceRef } from "@/effect/instance-ref"
import * as Log from "@opencode-ai/core/util/log"
import { Database } from "@opencode-ai/core/database/database"
import type { InstanceContext } from "@/project/instance-context"
import type { Session as SessionInfo } from "@/session/session"
import { GoalLink } from "@/kilocode/session/goal/link"
import { GoalState } from "@/kilocode/session/goal/state"
import { errorMessage } from "@/util/error"
import { Cause, Effect, Layer } from "effect"
import { Fire, type Info } from "./schema"

const log = Log.create({ service: "wakeup" })

/** The prompt the model sees when a wakeup fires: the scheduled text plus wakeup context. */
export function text(info: Info, kind?: "wakeup" | "cron"): string {
  if (kind === "cron") {
    return `[scheduled cron task] ${info.prompt}\n\n(No user is present. You scheduled this recurring task yourself as ${info.id}, due ${new Date(info.dueAt).toISOString()}.)`
  }
  return `[scheduled wakeup] ${info.prompt}\n\n(No user is present. You scheduled this wakeup yourself as ${info.id}, due ${new Date(info.dueAt).toISOString()}.)`
}

/**
 * Settles a waiting goal that will not resume from this fire as paused with `reason`. `hydrate`
 * armed the question-gate hold and the wait record; a paused goal that still reads as held keeps
 * the question tool filtered out and leaks the wait record, so both are undone. With `held`, a goal
 * that settled while the fire's hooks ran (complete, blocked, paused) is left as it is.
 */
const release = Effect.fn("Wakeup.release")(function* (info: Info, reason: string, held = false) {
  const { Session } = yield* Effect.promise(() => import("@/session/session"))
  const sessions = yield* Session.Service
  const latest = yield* sessions.get(info.sessionID)
  const saved = GoalState.read(latest.metadata)
  if (held && saved?.status !== "waiting" && saved?.status !== "active") return
  GoalLink.clear(info.sessionID)
  GoalState.clearWaiting(info.sessionID)
  GoalState.clearCurb(info.sessionID)
  if (!saved) return
  yield* sessions.setMetadata({
    sessionID: info.sessionID,
    metadata: {
      ...latest.metadata,
      "kilo.goal": { text: saved.text, status: "paused", active: false, reason },
    },
  })
})

/**
 * Delivers a fired wakeup after its WakeupFire hooks: resumes the waiting goal (`wait`) or prompts
 * the session. The fire runs it detached, so a slow hook never holds the timer, and an overdue wake
 * firing from `adopt` never holds the directory's instance bootstrap. The session's turn is forked
 * on its own, so it never holds a slot of the shared bound on detached hook runs.
 */
export const deliver = Effect.fn("Wakeup.deliver")(function* (input: {
  info: Info
  kind?: "wakeup" | "cron"
  session: SessionInfo.Info
  wait?: GoalLink.Wait
}) {
  const [{ Config }, { Session }, { SessionPrompt }, { EventV2Bridge }, { KiloHookUnattended }, { Wakeup }] =
    yield* Effect.promise(() =>
      Promise.all([
        import("@/config/config"),
        import("@/session/session"),
        import("@/session/prompt"),
        import("@/event-v2-bridge"),
        import("@/kilocode/hooks/unattended"),
        import("@/kilocode/wakeup"),
      ]),
    )
  const info = input.info
  const verdict = yield* KiloHookUnattended.wake({
    info,
    kind: input.kind,
    session: input.session,
    goal: input.wait !== undefined,
    config: yield* Config.Service,
    database: yield* Database.Service,
    sessions: yield* Session.Service,
    events: yield* EventV2Bridge.Service,
  })
  if (verdict.skip !== undefined) {
    log.info("WakeupFire hook skipped the wake", { id: info.id, sessionID: info.sessionID, reason: verdict.skip })
    const wait = input.wait
    if (!wait) return
    // A cron wait that is still scheduled keeps waiting for its next occurrence. A one-shot wait,
    // or a cron whose last occurrence this was, would wait forever: its goal pauses instead.
    if (wait.kind === "cron") {
      const tasks = yield* (yield* Wakeup.Service).cronList({ sessionID: info.sessionID })
      if (tasks.some((task) => task.id === wait.id)) return
    }
    const reason = `WakeupFire hook skipped the wake: ${verdict.skip}`
    // A running goal turn may be about to wait on this wake: the runner pauses before it suspends.
    if (GoalState.active(info.sessionID)) {
      KiloHookUnattended.drop(info.sessionID, wait.id, reason)
      return
    }
    yield* release(info, reason, true)
    return
  }
  const note = text(info, input.kind) + verdict.context
  // A waiting goal must resume as a goal turn (D2/D4), not as a stranger prompt and not as a
  // paused-session refusal. An in-flight goal turn queues the fire instead of starting a second
  // run (D3), even before the wait is persisted at the end of that turn.
  if (input.wait) {
    yield* GoalLink.resumeOrQueue(info.sessionID, note, input.wait, info.directory).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
        const err = Cause.squash(cause)
        log.error("wakeup could not resume session", {
          id: info.id,
          sessionID: info.sessionID,
          directory: info.directory,
          err,
        })
        return release(info, errorMessage(err))
      }),
    )
    return
  }
  const prompt = yield* SessionPrompt.Service
  yield* Effect.forkDetach(
    prompt
      .prompt({
        sessionID: info.sessionID,
        agent: info.agent,
        parts: [
          {
            type: "text",
            text: note,
            synthetic: true,
            metadata: { background: true, wakeup: true, wakeupID: info.id },
          },
        ],
      })
      .pipe(Effect.catchCause((cause) => Effect.logError("wakeup prompt failed", { id: info.id, cause }))),
  )
})

// Wakeups and cron tasks whose fire is still being delivered (its WakeupFire hooks running). A cron
// occurrence that comes due meanwhile is skipped, like one whose previous fire is still running.
const delivering = new Set<string>()

async function resume(info: Info, inst?: InstanceContext, inPlace = false, kind?: "wakeup" | "cron") {
  try {
    const [{ AppRuntime }, { Session }, { SessionPrompt }, { KiloHookLifecycle }] = await Promise.all([
      import("@/effect/app-runtime"),
      import("@/session/session"),
      import("@/session/prompt"),
      import("@/kilocode/hooks/lifecycle"),
    ])
    const fn = async () => {
      if (delivering.has(info.id)) {
        log.info("wakeup skipped: its previous fire is still being delivered", {
          id: info.id,
          sessionID: info.sessionID,
        })
        return
      }
      const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(info.sessionID)))
      // An in-flight goal turn owns every fire (D3), even before its wait is persisted.
      const wait = GoalLink.claim(info.sessionID, info, kind, session.metadata)
      // Construct SessionPrompt so Goal.make binds the instance factory and
      // hydrates waiting sessions. Ignore the paused flag for a matching wait.
      const paused = await AppRuntime.runPromise(SessionPrompt.Service.use((svc) => svc.paused(info.sessionID)))
      if (wait) GoalLink.hydrate(info.sessionID, session.metadata)
      // The prompt path drops a synthetic turn while the session is paused, so
      // the wake would vanish without a trace. Refuse it here and log instead.
      if (!wait && paused) {
        log.error("wakeup could not resume session", {
          id: info.id,
          sessionID: info.sessionID,
          directory: info.directory,
          reason: "session is paused",
        })
        return
      }
      // Fork the hooks and the turn so the firing timer never blocks on them. The hooks run like
      // every detached hook: in the instance scope (disposing the instance kills them), behind the
      // shared bound on concurrent runs.
      await AppRuntime.runPromise(
        KiloHookLifecycle.detach(
          Effect.sync(() => delivering.add(info.id)).pipe(
            Effect.andThen(deliver({ info, kind, session, wait })),
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Effect.logError("wakeup delivery failed", { id: info.id, cause }),
            ),
            Effect.ensuring(Effect.sync(() => delivering.delete(info.id))),
          ),
        ),
      )
    }
    // An overdue wake fires from `adopt` while its directory's instance is still
    // bootstrapping. Re-entering `provide` would await that very load and
    // deadlock, so that path resumes in place. A timer fire happens after
    // bootstrap, so it re-resolves the instance and picks up a reload.
    if (inPlace && inst && inst.directory === info.directory) {
      await Instance.restore(inst, fn)
      return
    }
    await provide({ directory: info.directory, fn })
  } catch (err) {
    log.error("wakeup could not resume session", {
      id: info.id,
      sessionID: info.sessionID,
      directory: info.directory,
      err,
    })
  }
}

export const fireLayer = Layer.succeed(
  Fire,
  Fire.of({
    run: (info, options) =>
      Effect.gen(function* () {
        const inst = yield* InstanceRef
        yield* Effect.promise(() => resume(info, inst, options?.inPlace === true, options?.kind))
      }),
  }),
)
