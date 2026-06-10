import { Bus } from "@/bus"
import * as Config from "@/config/config"
import { Permission } from "@/permission"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { Event } from "@/server/event"
import { Effect } from "effect"
import z from "zod"

export namespace AllowEverythingPermission {
  export type Input = z.infer<typeof Permission.AllowEverythingInput>

  export function effect(input: Input) {
    return Effect.gen(function* () {
      const svc = yield* Permission.Service
      const sessions = yield* Session.Service
      const cfg = yield* Config.Service
      const bus = yield* Bus.Service
      const rules: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

      if (!input.enable) {
        if (input.sessionID) {
          const id = SessionID.make(input.sessionID)
          const session = yield* sessions.get(id).pipe(Effect.orDie)
          yield* sessions.setPermission({
            sessionID: id,
            permission: (session.permission ?? []).filter(
              (rule) => !(rule.permission === "*" && rule.pattern === "*" && rule.action === "allow"),
            ),
          })
          yield* svc.allowEverything({ enable: false, sessionID: id })
          return true
        }

        yield* cfg.updateGlobal({ permission: { "*": { "*": null } } }, { dispose: false })
        yield* svc.allowEverything({ enable: false })
        yield* bus.publish(Event.ConfigUpdated, {})
        return true
      }

      if (input.sessionID) {
        const id = SessionID.make(input.sessionID)
        const session = yield* sessions.get(id).pipe(Effect.orDie)
        yield* sessions.setPermission({
          sessionID: id,
          permission: [...(session.permission ?? []), ...rules],
        })
      }

      if (!input.sessionID) {
        yield* cfg.updateGlobal({ permission: Permission.toConfig(rules) }, { dispose: false })
        yield* bus.publish(Event.ConfigUpdated, {})
      }

      yield* svc.allowEverything({
        enable: true,
        requestID: input.requestID,
        sessionID: input.sessionID ? SessionID.make(input.sessionID) : undefined,
      })

      return true
    })
  }
}
