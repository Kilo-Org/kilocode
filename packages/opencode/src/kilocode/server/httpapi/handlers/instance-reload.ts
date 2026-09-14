import * as InstanceState from "@/effect/instance-state"
import { reloadProject } from "@/kilocode/project/reload"
import { InstanceStore } from "@/project/instance-store"
import { SessionStatus } from "@/session/status"
import { ConflictError } from "@/server/routes/instance/httpapi/errors"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import type { SessionID } from "@/session/schema"

export function hasActiveSession(statuses: Map<SessionID, SessionStatus.Info>): boolean {
  for (const info of statuses.values()) {
    if (info.type !== "idle") return true
  }
  return false
}

export const instanceReloadHandlers = HttpApiBuilder.group(InstanceHttpApi, "instance-reload", (handlers) =>
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service

    const reload = Effect.fn("InstanceReloadHttpApi.reload")(function* () {
      const ctx = yield* InstanceState.context
      if (hasActiveSession(yield* SessionStatus.listAll())) {
        return yield* Effect.fail(
          new ConflictError({
            message:
              "Cannot reload while a session is running in this project. Wait for it to finish or abort it first.",
          }),
        )
      }
      yield* reloadProject(store, String(ctx.project.id))
      return true
    })

    return handlers.handle("reload", reload)
  }),
)
