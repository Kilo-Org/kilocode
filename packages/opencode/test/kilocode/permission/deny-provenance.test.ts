import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { Bus } from "../../../src/bus"
import { Permission } from "../../../src/permission"
import { PermissionProvenance } from "../../../src/kilocode/permission/provenance"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { SessionID } from "../../../src/session/schema"
import * as Config from "../../../src/config/config"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const env = Layer.mergeAll(
  Permission.layer.pipe(
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Database.defaultLayer),
  ),
  Config.defaultLayer,
  Bus.layer,
  CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env)

const ask = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

function withDir(options: { git?: boolean } | undefined, self: (dir: string) => Effect.Effect<any, any, any>) {
  return provideTmpdirInstance(self, options)
}

describe("Permission.ask denial provenance", () => {
  it.live(
    "attributes a denial to the rule that matched the request's pattern, not just the textually-last deny rule for the permission",
    () =>
      withDir({ git: true }, () =>
        Effect.gen(function* () {
          // Two deny rules under the same permission for different patterns. Matching by
          // permission alone (e.g. findLast over rules with action "deny") would pick
          // "rm -rf *" here since it sorts last, even though "git push *" is the one that
          // actually matched the request.
          const ruleset = [
            { permission: "bash", pattern: "git push *", action: "deny" as const },
            { permission: "bash", pattern: "rm -rf *", action: "deny" as const },
          ]
          const exit = yield* ask({
            sessionID: SessionID.make("session_test"),
            permission: "bash",
            patterns: ["git push origin main"],
            metadata: {},
            always: [],
            ruleset,
          }).pipe(Effect.exit)

          expect(Exit.isFailure(exit)).toBe(true)
          const err = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
          expect(err).toBeInstanceOf(Permission.DeniedError)

          const approval = PermissionProvenance.classifyDenial({
            ruleset: (err as Permission.DeniedError).ruleset,
            permission: "bash",
            patterns: ["git push origin main"],
            agent: "build",
            origins: undefined,
          })
          expect(approval.rule).toEqual({ permission: "bash", pattern: "git push *", action: "deny" })
        }),
      ),
  )

  test("a denial with no specific rule (e.g. a headless-subagent policy denial) is still reported as denied, not as an ambiguous default approval", () => {
    // Some denial paths don't carry a specific rule -- Permission.ask's headless-subagent policy
    // denial, for instance, still sets `ruleset` to the plain deny-permission subset (an array,
    // with no `.action`/`.pattern` of its own). classify({ rule: undefined }) reports
    // { source: "default" } -- the same shape the *approval* fallback produces for "no rule
    // matched" -- so without a synthesized deny rule, a refusal would render (and export) as an
    // auto-approval.
    const approval = PermissionProvenance.classifyDenial({
      ruleset: [{ permission: "bash", pattern: "*", action: "ask" as const }],
      permission: "bash",
      patterns: ["rm -rf /"],
      agent: "build",
      origins: undefined,
    })
    expect(approval.rule?.action).toBe("deny")
    expect(approval.rule).toEqual({ permission: "bash", pattern: "rm -rf /", action: "deny" })
  })
})
