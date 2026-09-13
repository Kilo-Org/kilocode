import { Instance, provide } from "@/kilocode/instance"
import { InstanceRef } from "@/effect/instance-ref"
import * as Log from "@opencode-ai/core/util/log"
import type { InstanceContext } from "@/project/instance-context"
import { Effect, Layer } from "effect"
import { Fire, type Info } from "./schema"

const log = Log.create({ service: "wakeup" })

/** The prompt the model sees when a wakeup fires: the scheduled text plus wakeup context. */
export function text(info: Info): string {
  return `[scheduled wakeup] ${info.prompt}\n\n(No user is present. You scheduled this wakeup yourself as ${info.id}, due ${new Date(info.dueAt).toISOString()}.)`
}

async function resume(info: Info, inst?: InstanceContext) {
  try {
    const [{ AppRuntime }, { Session }, { SessionPrompt }] = await Promise.all([
      import("@/effect/app-runtime"),
      import("@/session/session"),
      import("@/session/prompt"),
    ])
    const fn = async () => {
      await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(info.sessionID)))
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
                    text: text(info),
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
    // An overdue wake fires while its directory's instance is still bootstrapping.
    // Re-entering `provide` would await that very load and deadlock, so when the
    // firing context already is the wake's directory, resume in place instead.
    if (inst && inst.directory === info.directory) {
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
    run: (info) =>
      Effect.gen(function* () {
        const inst = yield* InstanceRef
        yield* Effect.promise(() => resume(info, inst))
      }),
  }),
)
