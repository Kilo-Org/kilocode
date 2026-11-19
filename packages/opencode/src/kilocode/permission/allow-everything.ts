import * as Config from "@/config/config"
import { Permission } from "@/permission"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { Effect } from "effect"
import z from "zod"

export namespace AllowEverythingPermission {
  export type Input = z.infer<typeof Permission.AllowEverythingInput>

  export function effect(input: Input) {
    return Effect.gen(function* () {
      const svc = yield* Permission.Service
      const sessions = yield* Session.Service
      const cfg = yield* Config.Service
      const rules: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

      const id = input.sessionID ? SessionID.make(input.sessionID) : undefined
      const persist = Effect.gen(function* () {
        if (!id) {
          yield* cfg.updateGlobal(
            { permission: input.enable ? Permission.toConfig(rules) : { "*": { "*": null } } },
            { dispose: false },
          )
          return
        }
        const session = yield* sessions.get(id).pipe(Effect.orDie)
        yield* sessions.setPermission({
          sessionID: id,
          permission: input.enable
            ? [...(session.permission ?? []), ...rules]
            : (session.permission ?? []).filter(
                (rule) => !(rule.permission === "*" && rule.pattern === "*" && rule.action === "allow"),
              ),
        })
      })
      return yield* svc.allowEverything({ ...input, sessionID: id }, persist)
    })
  }
}
