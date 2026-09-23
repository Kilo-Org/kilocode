import { Instance, provide } from "@/kilocode/instance"
import { InstanceRef } from "@/effect/instance-ref"
import * as Log from "@opencode-ai/core/util/log"
import type { InstanceContext } from "@/project/instance-context"
import { GoalLink } from "@/kilocode/session/goal/link"
import { GoalState } from "@/kilocode/session/goal/state"
import { Effect, Layer } from "effect"
import { Fire, type Info } from "./schema"

const log = Log.create({ service: "wakeup" })

/** The prompt the model sees when a wakeup fires: the scheduled text plus wakeup context. */
export function text(info: Info, kind?: "wakeup" | "cron"): string {
  if (kind === "cron") {
    return `[scheduled cron task] ${info.prompt}\n\n(No user is present. You scheduled this recurring task yourself as ${info.id}, due ${new Date(info.dueAt).toISOString()}.)`
  }
  return `[scheduled wakeup] ${info.prompt}\n\n(No user is present. You scheduled this wakeup yourself as ${info.id}, due ${new Date(info.dueAt).toISOString()}.)`
}

async function resume(info: Info, inst?: InstanceContext, inPlace = false, kind?: "wakeup" | "cron") {
  try {
    const [{ AppRuntime }, { Session }, { SessionPrompt }] = await Promise.all([
      import("@/effect/app-runtime"),
      import("@/session/session"),
      import("@/session/prompt"),
    ])
    const fn = async () => {
      const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(info.sessionID)))
      // A waiting goal must resume as a goal turn (D2/D4), not as a stranger
      // prompt and not as a paused-session refusal. An in-flight goal turn
      // queues the fire instead of starting a second run (D3), even before
      // the wait is persisted at the end of that turn.
      const wait = GoalLink.claim(info.sessionID, info, kind, session.metadata)
      // Construct SessionPrompt so Goal.make binds the instance factory and
      // hydrates waiting sessions. Ignore the paused flag for a matching wait.
      const paused = await AppRuntime.runPromise(SessionPrompt.Service.use((svc) => svc.paused(info.sessionID)))
      if (wait) {
        GoalLink.hydrate(info.sessionID, session.metadata)
        const note = text(info, kind)
        try {
          await AppRuntime.runPromise(GoalLink.resumeOrQueue(info.sessionID, note, wait, info.directory))
        } catch (err) {
          log.error("wakeup could not resume session", {
            id: info.id,
            sessionID: info.sessionID,
            directory: info.directory,
            err,
          })
          const latest = await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(info.sessionID)))
          const saved = GoalState.read(latest.metadata)
          if (saved) {
            await AppRuntime.runPromise(
              Session.Service.use((svc) =>
                svc.setMetadata({
                  sessionID: info.sessionID,
                  metadata: {
                    ...latest.metadata,
                    "kilo.goal": {
                      text: saved.text,
                      status: "paused",
                      active: false,
                      reason: err instanceof Error ? err.message : String(err),
                    },
                  },
                }),
              ),
            )
          }
        }
        return
      }
      // The prompt path drops a synthetic turn while the session is paused, so
      // the wake would vanish without a trace. Refuse it here and log instead.
      if (paused) {
        log.error("wakeup could not resume session", {
          id: info.id,
          sessionID: info.sessionID,
          directory: info.directory,
          reason: "session is paused",
        })
        return
      }
      // Fork the turn so the firing timer never blocks on the model running.
      await AppRuntime.runPromise(
        SessionPrompt.Service.use((svc) =>
          Effect.forkDetach(
            svc
              .prompt({
                sessionID: info.sessionID,
                agent: info.agent,
                parts: [
                  {
                    type: "text",
                    text: text(info, kind),
                    synthetic: true,
                    metadata: { background: true, wakeup: true, wakeupID: info.id },
                  },
                ],
              })
              .pipe(Effect.catchCause((cause) => Effect.logError("wakeup prompt failed", { id: info.id, cause }))),
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
