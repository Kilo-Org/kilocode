// kilocode_change - new file
import { expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Permission } from "@/permission"
import * as Config from "@/config/config"
import { SessionID } from "@/session/schema"
import { PermissionProvenance } from "@/kilocode/permission/provenance"
import { testEffect } from "../../lib/effect"

/**
 * Who actually answered the prompt.
 *
 * Auto mode answers on the user's behalf from the client, and that reply deliberately omits
 * `interactive` — the same signal the reject path already uses to tell an answered refusal from a
 * cascaded one. Without carrying it through the approval too, a call nobody looked at is reported
 * as "approved by you", which is a claim about the user that is simply untrue.
 */
const env = Layer.mergeAll(
  AppNodeBuilder.build(Permission.node),
  AppNodeBuilder.build(Config.node),
  AppNodeBuilder.build(CrossSpawnSpawner.node),
)
const it = testEffect(env)

const sessionID = SessionID.make("ses_auto_reply")

const request = {
  sessionID,
  permission: "bash",
  patterns: ["git status"],
  always: [] as string[],
  metadata: {},
  ruleset: [{ permission: "bash", pattern: "*", action: "ask" as const }],
}

const answer = (interactive: boolean | undefined) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const fiber = yield* Effect.gen(function* () {
      return yield* permission.ask(request)
    }).pipe(Effect.forkScoped)

    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))

    yield* permission.reply({
      requestID: pending[0]!.id,
      reply: "once",
      ...(interactive === undefined ? {} : { interactive }),
    })
    return yield* Fiber.join(fiber)
  })

it.instance("reports a reply a human actually gave as interactive", () =>
  Effect.gen(function* () {
    const outcome = yield* answer(true)
    expect(outcome.manual).toBe(true)
    expect(outcome.interactive).toBe(true)
  }),
)

it.instance("reports a client's auto-reply as not interactive", () =>
  Effect.gen(function* () {
    const outcome = yield* answer(undefined)
    expect(outcome.manual).toBe(true)
    expect(outcome.interactive).toBe(false)
  }),
)

it.instance("a human's approval is attributed to the user", () =>
  Effect.gen(function* () {
    const outcome = yield* answer(true)
    expect(PermissionProvenance.fromManual(outcome).source).toBe("manual")
  }),
)

it.instance("an auto-reply is attributed to auto mode, not to the user", () =>
  Effect.gen(function* () {
    const outcome = yield* answer(undefined)
    expect(PermissionProvenance.fromManual(outcome).source).toBe("auto")
  }),
)
