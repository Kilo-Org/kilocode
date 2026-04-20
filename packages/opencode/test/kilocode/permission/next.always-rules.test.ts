import { expect, describe, afterAll } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { Bus } from "../../../src/bus"
import { Permission } from "../../../src/permission"
import { PermissionID } from "../../../src/permission/schema"
import { SessionID } from "../../../src/session/schema"
import { Config } from "../../../src/config/config"
import { Global } from "../../../src/global"
import * as CrossSpawnSpawner from "../../../src/effect/cross-spawn-spawner"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const bus = Bus.layer
const env = Layer.mergeAll(Permission.layer.pipe(Layer.provide(bus)), bus, CrossSpawnSpawner.defaultLayer)
const it = testEffect(env)

afterAll(async () => {
  const dir = Global.Path.config
  for (const file of ["kilo.jsonc", "kilo.json", "config.json", "opencode.json", "opencode.jsonc"]) {
    await fs.rm(path.join(dir, file), { force: true }).catch(() => {})
  }
  await Config.invalidate(true)
})

const ask = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const reply = (input: Parameters<Permission.Interface["reply"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.reply(input)
  })

const saveAlwaysRules = (input: Parameters<Permission.Interface["saveAlwaysRules"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.saveAlwaysRules(input)
  })

const list = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.list()
  })

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (let i = 0; i < 100; i++) {
      const items = yield* permission.list()
      if (items.length >= count) return items
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`))
  })

function withDir(options: { git?: boolean } | undefined, self: (dir: string) => Effect.Effect<any, any, any>) {
  return provideTmpdirInstance(self, options)
}

const expectFailure = <E>(exit: Exit.Exit<unknown, E>, ErrorClass: new (...args: any[]) => unknown) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(Cause.squash(exit.cause)).toBeInstanceOf(ErrorClass)
  }
}

describe("saveAlwaysRules", () => {
  it.live("approved rules auto-allow future requests", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const asking = yield* ask({
          id: PermissionID.make("permission_1"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *", "npm install"] },
          always: ["npm install *"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_1"),
          approvedAlways: ["npm install"],
        })
        yield* reply({ requestID: PermissionID.make("permission_1"), reply: "once" })
        yield* Fiber.join(asking)

        const result = yield* ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(result).toBeUndefined()
      }),
    ),
  )

  it.live("denied rules auto-deny future requests", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const asking = yield* ask({
          id: PermissionID.make("permission_2"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: { rules: ["rm *", "rm -rf /"] },
          always: ["rm *"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_2"),
          deniedAlways: ["rm -rf /"],
        })
        yield* reply({ requestID: PermissionID.make("permission_2"), reply: "once" })
        yield* Fiber.join(asking)

        const exit = yield* ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [],
        }).pipe(Effect.exit)
        expectFailure(exit, Permission.DeniedError)
      }),
    ),
  )

  it.live("silently skips unknown request ID", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        // saveAlwaysRules silently returns when the request ID is not in the pending map
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_nonexistent"),
          approvedAlways: ["npm install"],
        })
      }),
    ),
  )

  it.live("ignores patterns not in metadata.rules or always", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const asking = yield* ask({
          id: PermissionID.make("permission_3"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *", "npm install"] },
          always: ["npm install *"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        // "curl" is not in metadata.rules or always — should be silently ignored
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_3"),
          approvedAlways: ["npm install", "curl http://evil.com"],
        })

        yield* reply({ requestID: PermissionID.make("permission_3"), reply: "once" })
        yield* Fiber.join(asking)

        // npm install was in rules — auto-allowed
        const result = yield* ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(result).toBeUndefined()

        // curl was NOT in rules — still requires permission
        const curlFiber = yield* ask({
          id: PermissionID.make("permission_curl"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["curl http://evil.com"],
          metadata: {},
          always: [],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        yield* reply({ requestID: PermissionID.make("permission_curl"), reply: "reject" })
        expectFailure(yield* Fiber.await(curlFiber), Permission.RejectedError)
      }),
    ),
  )

  it.live("accepts patterns from always array (non-bash tools)", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const asking = yield* ask({
          id: PermissionID.make("permission_nonbash"),
          sessionID: SessionID.make("session_test"),
          permission: "read",
          patterns: ["src/main.ts"],
          metadata: {},
          always: ["*"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        // "*" is in always — should be accepted even without metadata.rules
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_nonbash"),
          approvedAlways: ["*"],
        })
        yield* reply({ requestID: PermissionID.make("permission_nonbash"), reply: "once" })
        yield* Fiber.join(asking)

        // "*" wildcard should auto-allow any read
        const result = yield* ask({
          sessionID: SessionID.make("session_test"),
          permission: "read",
          patterns: ["any/file.ts"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(result).toBeUndefined()
      }),
    ),
  )

  it.live("accepts hierarchy patterns from metadata.rules", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const asking = yield* ask({
          id: PermissionID.make("permission_4"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install lodash"],
          metadata: { rules: ["npm *", "npm install *", "npm install lodash"] },
          always: ["npm install *"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        // Approve the broadest hierarchy level
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_4"),
          approvedAlways: ["npm *"],
        })
        yield* reply({ requestID: PermissionID.make("permission_4"), reply: "once" })
        yield* Fiber.join(asking)

        // "npm *" wildcard should auto-allow any npm command
        const result = yield* ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm test"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(result).toBeUndefined()
      }),
    ),
  )

  it.live("mixed allow/deny preserves metadata.rules order", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const asking = yield* ask({
          id: PermissionID.make("permission_5"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install lodash"],
          metadata: { rules: ["npm *", "npm install *"] },
          always: ["npm install *"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        // Deny broad, allow specific — specific should win
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_5"),
          approvedAlways: ["npm install *"],
          deniedAlways: ["npm *"],
        })
        yield* reply({ requestID: PermissionID.make("permission_5"), reply: "once" })
        yield* Fiber.join(asking)

        // "npm install foo" matches both rules; "npm install *" (allow) comes
        // after "npm *" (deny) in metadata.rules order, so allow wins
        const result = yield* ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install foo"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(result).toBeUndefined()
      }),
    ),
  )

  it.live("deny broad + allow specific: specific allow wins", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const asking = yield* ask({
          id: PermissionID.make("permission_6"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["git log --oneline"],
          metadata: { rules: ["git *", "git log *"] },
          always: ["git log *"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_6"),
          approvedAlways: ["git log *"],
          deniedAlways: ["git *"],
        })
        yield* reply({ requestID: PermissionID.make("permission_6"), reply: "once" })
        yield* Fiber.join(asking)

        // "git log --oneline" should be allowed (specific allow after broad deny)
        const allowed = yield* ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["git log --oneline"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(allowed).toBeUndefined()

        // "git status" should be denied (only matches broad deny)
        const exit = yield* ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["git status"],
          metadata: {},
          always: [],
          ruleset: [],
        }).pipe(Effect.exit)
        expectFailure(exit, Permission.DeniedError)
      }),
    ),
  )

  it.live("rules not in metadata.rules are silently ignored", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const asking = yield* ask({
          id: PermissionID.make("permission_7"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *"] },
          always: ["npm *"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        // "curl" is not in metadata.rules — should be silently ignored
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_7"),
          approvedAlways: ["npm *", "curl *"],
        })
        yield* reply({ requestID: PermissionID.make("permission_7"), reply: "once" })
        yield* Fiber.join(asking)

        // curl should still require permission (not auto-allowed)
        const curlFiber = yield* ask({
          id: PermissionID.make("permission_curl2"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["curl http://example.com"],
          metadata: {},
          always: [],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        yield* reply({ requestID: PermissionID.make("permission_curl2"), reply: "reject" })
        expectFailure(yield* Fiber.await(curlFiber), Permission.RejectedError)
      }),
    ),
  )

  it.live("auto-resolves pending permission from sibling session", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const fiberA = yield* ask({
          id: PermissionID.make("permission_a"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *"] },
          always: ["npm *"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        const fiberB = yield* ask({
          id: PermissionID.make("permission_b"),
          sessionID: SessionID.make("session_b"),
          permission: "bash",
          patterns: ["npm test"],
          metadata: {},
          always: [],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(2)
        // User approves "npm *" on subagent A's permission
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_a"),
          approvedAlways: ["npm *"],
        })

        // Subagent B should auto-resolve because "npm test" matches "npm *"
        yield* reply({ requestID: PermissionID.make("permission_a"), reply: "once" })
        yield* Fiber.join(fiberA)
        yield* Fiber.join(fiberB)
      }),
    ),
  )

  it.live("auto-resolves multiple pending permissions from different sessions", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const fiberA = yield* ask({
          id: PermissionID.make("permission_a2"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["npm install lodash"],
          metadata: { rules: ["npm *", "npm install *"] },
          always: ["npm *"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        const fiberB = yield* ask({
          id: PermissionID.make("permission_b2"),
          sessionID: SessionID.make("session_b"),
          permission: "bash",
          patterns: ["npm run build"],
          metadata: {},
          always: [],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        const fiberC = yield* ask({
          id: PermissionID.make("permission_c2"),
          sessionID: SessionID.make("session_c"),
          permission: "bash",
          patterns: ["npm test"],
          metadata: {},
          always: [],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(3)
        // Approve "npm *" on session A — should auto-resolve B and C
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_a2"),
          approvedAlways: ["npm *"],
        })
        yield* reply({ requestID: PermissionID.make("permission_a2"), reply: "once" })

        yield* Fiber.join(fiberA)
        yield* Fiber.join(fiberB)
        yield* Fiber.join(fiberC)
      }),
    ),
  )

  it.live("does not auto-resolve pending permission with non-matching pattern", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const fiberA = yield* ask({
          id: PermissionID.make("permission_a3"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *"] },
          always: ["npm *"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        const fiberB = yield* ask({
          id: PermissionID.make("permission_b3"),
          sessionID: SessionID.make("session_b"),
          permission: "bash",
          patterns: ["curl http://example.com"],
          metadata: {},
          always: [],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(2)
        // Approve "npm *" — should NOT resolve B (curl doesn't match npm *)
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_a3"),
          approvedAlways: ["npm *"],
        })
        yield* reply({ requestID: PermissionID.make("permission_a3"), reply: "once" })
        yield* Fiber.join(fiberA)

        // B should still be pending — reject it to clean up
        yield* reply({ requestID: PermissionID.make("permission_b3"), reply: "reject" })
        expectFailure(yield* Fiber.await(fiberB), Permission.RejectedError)
      }),
    ),
  )

  it.live("does not auto-resolve the request being replied to", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const fiberA = yield* ask({
          id: PermissionID.make("permission_a4"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *"] },
          always: ["npm *"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        // Save rules but don't reply yet — the request itself should not be auto-resolved
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_a4"),
          approvedAlways: ["npm *"],
        })

        // The original request should still be pending (needs explicit reply)
        const pending = yield* list()
        expect(pending.some((p) => String(p.id) === "permission_a4")).toBe(true)

        yield* reply({ requestID: PermissionID.make("permission_a4"), reply: "once" })
        yield* Fiber.join(fiberA)
      }),
    ),
  )

  it.live("auto-rejects pending permission from sibling session when denied", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        const fiberA = yield* ask({
          id: PermissionID.make("permission_a5"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["git log --oneline -5"],
          metadata: { rules: ["git *", "git log *"] },
          always: ["git log *"],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        const fiberB = yield* ask({
          id: PermissionID.make("permission_b5"),
          sessionID: SessionID.make("session_b"),
          permission: "bash",
          patterns: ["git log --oneline -10"],
          metadata: {},
          always: [],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(2)
        // User denies "git log *" on subagent A
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_a5"),
          deniedAlways: ["git log *"],
        })

        // Subagent B should auto-reject because "git log --oneline -10" matches denied "git log *"
        yield* reply({ requestID: PermissionID.make("permission_a5"), reply: "once" })
        yield* Fiber.join(fiberA)
        expectFailure(yield* Fiber.await(fiberB), Permission.RejectedError)
      }),
    ),
  )

  it.live("multi-pattern: auto-resolves when new rule covers blocking pattern and ruleset covers the rest", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        // Subagent B has "git status && npm install" — two patterns.
        // Its ruleset already allows "npm install" but "git status" is "ask".
        const fiberB = yield* ask({
          id: PermissionID.make("permission_multi_b"),
          sessionID: SessionID.make("session_b"),
          permission: "bash",
          patterns: ["git status", "npm install"],
          metadata: {},
          always: [],
          ruleset: [
            { permission: "bash", pattern: "*", action: "ask" },
            { permission: "bash", pattern: "npm install", action: "allow" },
          ],
        }).pipe(Effect.forkScoped)

        // Subagent A gets "git status" approved
        const fiberA = yield* ask({
          id: PermissionID.make("permission_multi_a"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["git status"],
          metadata: { rules: ["git *"] },
          always: ["git *"],
          ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(2)
        // User approves "git *" on subagent A
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_multi_a"),
          approvedAlways: ["git *"],
        })
        yield* reply({ requestID: PermissionID.make("permission_multi_a"), reply: "once" })

        // B should auto-resolve: "git status" covered by new rule, "npm install" covered by original ruleset
        yield* Fiber.join(fiberA)
        yield* Fiber.join(fiberB)
      }),
    ),
  )

  it.live("multi-pattern: stays pending when new rule covers one pattern but ruleset doesn't cover the other", () =>
    withDir({ git: true }, () =>
      Effect.gen(function* () {
        // Subagent B has "git status && curl http://evil.com" — two patterns.
        // Neither is allowed by the ruleset.
        const fiberB = yield* ask({
          id: PermissionID.make("permission_multi_b2"),
          sessionID: SessionID.make("session_b"),
          permission: "bash",
          patterns: ["git status", "curl http://evil.com"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
        }).pipe(Effect.forkScoped)

        const fiberA = yield* ask({
          id: PermissionID.make("permission_multi_a2"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["git status"],
          metadata: { rules: ["git *"] },
          always: ["git *"],
          ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
        }).pipe(Effect.forkScoped)

        yield* waitForPending(2)
        // User approves "git *" — covers "git status" but NOT "curl"
        yield* saveAlwaysRules({
          requestID: PermissionID.make("permission_multi_a2"),
          approvedAlways: ["git *"],
        })
        yield* reply({ requestID: PermissionID.make("permission_multi_a2"), reply: "once" })
        yield* Fiber.join(fiberA)

        // B should still be pending (curl not covered)
        const pending = yield* list()
        expect(pending.some((p) => String(p.id) === "permission_multi_b2")).toBe(true)

        yield* reply({ requestID: PermissionID.make("permission_multi_b2"), reply: "reject" })
        expectFailure(yield* Fiber.await(fiberB), Permission.RejectedError)
      }),
    ),
  )
})
