// kilocode_change - new file
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../../src/account/account"
import { Auth } from "../../../src/auth"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { ConfigProtection } from "../../../src/kilocode/permission/config-paths"
import { Permission } from "../../../src/permission"
import { Plugin } from "../../../src/plugin"
import { SessionID } from "../../../src/session/schema"
import { TestInstance } from "../../fixture/fixture"
import { AccountTest } from "../../fake/account"
import { AuthTest } from "../../fake/auth"
import { NpmTest } from "../../fake/npm"
import { testEffect } from "../../lib/effect"

// One compiled graph. The plugin layer registers its reviewer on the Permission
// service it resolves while being built, so a separate AppNodeBuilder.build per
// service would hand it a Permission instance these tests never ask, leaving the
// hook invisible.
const root = LayerNode.group([Plugin.node, Permission.node, CrossSpawnSpawner.node])
const it = testEffect(
  AppNodeBuilder.build(root, [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)

/**
 * Written by every hook below. Asserting on it keeps the "unrecognised status"
 * case honest: without it, a plugin that failed to load would leave behind
 * exactly the pending prompt that test is looking for.
 */
const MARKER = "permission-ask-hook-ran"

/**
 * A plugin whose only hook is `permission.ask`, with `body` as its statements. `marker` is the
 * file it writes on entry, so tests registering more than one plugin can tell them apart.
 */
function markedHookPlugin(marker: string, ...body: string[]) {
  return [
    "export default async ({ directory }) => ({",
    '  "permission.ask": async (input, output) => {',
    `    await Bun.write(directory + "/${marker}", input.permission)`,
    ...body,
    "  },",
    "})",
    "",
  ].join("\n")
}

function hookPlugin(...body: string[]) {
  return markedHookPlugin(MARKER, ...body)
}

const markerRan = (marker: string) =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    return yield* Effect.promise(() =>
      Bun.file(path.join(test.directory, marker))
        .text()
        .catch(() => undefined),
    )
  })

const hookRan = markerRan(MARKER)

/** Register `sources` as plugins, in order: `Plugin.trigger` runs the hooks in the order listed. */
function withPlugins<A, E, R>(sources: readonly string[], self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    const files = sources.map((_, index) => path.join(test.directory, `plugin-${index}.ts`))
    yield* Effect.all(
      [
        ...files.map((file, index) => Effect.promise(() => Bun.write(file, sources[index]!))),
        Effect.promise(() =>
          Bun.write(
            path.join(test.directory, "opencode.json"),
            JSON.stringify(
              {
                $schema: "https://app.kilo.ai/config.json",
                plugin: files.map((file) => pathToFileURL(file).href),
              },
              null,
              2,
            ),
          ),
        ),
      ],
      { discard: true, concurrency: "unbounded" },
    )
    return yield* self
  })
}

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return withPlugins([source], self)
}

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

const list = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.list()
  })

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    while (true) {
      const items = yield* list()
      if (items.length === count) return items
      yield* Effect.sleep("10 millis")
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`)),
    }),
  )

const fail = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* self.pipe(Effect.exit)
    if (Exit.isFailure(exit)) return Cause.squash(exit.cause)
    throw new Error("expected permission effect to fail")
  })

const request = (ruleset: Permission.Ruleset, overrides: Partial<Permission.AskInput> = {}) => ({
  sessionID: SessionID.make("session_test"),
  permission: "bash",
  patterns: ["npm install"],
  metadata: {},
  always: [],
  ruleset,
  ...overrides,
})

const allowBash: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]

/**
 * Deliberately broad. `ReadPermission.harden` *downgrades* a `*.env` read only
 * when the winning rule is broad (`permission` or `pattern` is `*`); a narrower
 * `read: *.env` allow is left alone. This ruleset exercises that downgrade — the
 * unruled read below is hardened by the other branch, not by this one.
 */
const allowRead: Permission.Ruleset = [{ permission: "read", pattern: "*", action: "allow" }]

describe("permission.ask plugin hook", () => {
  it.instance("allow settles a request the rules wanted to ask about", () =>
    withProject(
      hookPlugin('    output.status = "allow"'),
      Effect.gen(function* () {
        const outcome = yield* ask(request([]))
        expect(outcome).toEqual({ manual: false, plugin: true })
        expect(yield* list()).toEqual([])
      }),
    ),
  )

  it.instance("ask overrides a rule that would have auto-approved", () =>
    withProject(
      hookPlugin('    output.status = "ask"'),
      Effect.gen(function* () {
        const asking = yield* ask(request(allowBash)).pipe(Effect.forkScoped)

        const pending = yield* waitForPending(1)
        expect(pending[0]!.permission).toBe("bash")
        expect(pending[0]!.patterns).toEqual(["npm install"])

        yield* reply({ requestID: pending[0]!.id, reply: "once" })
        expect(yield* Fiber.join(asking)).toEqual({ manual: true })
        expect(yield* list()).toEqual([])
      }),
    ),
  )

  it.instance("deny fails the request and reports the hook's message", () =>
    withProject(
      hookPlugin('    output.status = "deny"', '    output.message = "blocked by the org policy plugin"'),
      Effect.gen(function* () {
        const error = yield* fail(ask(request(allowBash)))
        expect(error).toBeInstanceOf(Permission.DeniedError)
        const denied = error as Permission.DeniedError
        expect(denied.reason).toBe("blocked by the org policy plugin")
        expect(denied.message).toBe("blocked by the org policy plugin")
        expect(yield* list()).toEqual([])
      }),
    ),
  )

  it.instance("an unrecognised status keeps the rule decision instead of allowing", () =>
    withProject(
      hookPlugin('    output.status = "denied"'),
      Effect.gen(function* () {
        const asking = yield* ask(request([])).pipe(Effect.forkScoped)

        const pending = yield* waitForPending(1)
        expect(yield* hookRan).toBe("bash")

        yield* reply({ requestID: pending[0]!.id, reply: "once" })
        expect(yield* Fiber.join(asking)).toEqual({ manual: true })
      }),
    ),
  )

  // A hook may make a decision stricter. It may not cancel a prompt Kilo forces
  // regardless of the user's own allow rules — the cases below.

  it.instance("allow cannot cancel the prompt a skill shell forces", () =>
    withProject(
      hookPlugin('    output.status = "allow"'),
      Effect.gen(function* () {
        const asking = yield* ask(request(allowBash, { metadata: { skillShell: true } })).pipe(Effect.forkScoped)

        const pending = yield* waitForPending(1)
        expect(yield* hookRan).toBe("bash")

        // A skill-shell prompt refuses machine approvals, so answer it the way a
        // client with a human in front of it would.
        yield* reply({ requestID: pending[0]!.id, reply: "once", interactive: true })
        expect(yield* Fiber.join(asking)).toEqual({ manual: true })
        expect(yield* list()).toEqual([])
      }),
    ),
  )

  it.instance("allow cannot cancel the prompt a sandbox escalation forces", () =>
    withProject(
      hookPlugin('    output.status = "allow"'),
      Effect.gen(function* () {
        const asking = yield* ask(request(allowBash, { metadata: { sandboxEscalation: true } })).pipe(Effect.forkScoped)

        const pending = yield* waitForPending(1)
        expect(yield* hookRan).toBe("bash")

        yield* reply({ requestID: pending[0]!.id, reply: "once", interactive: true })
        expect(yield* Fiber.join(asking)).toEqual({ manual: true })
        expect(yield* list()).toEqual([])
      }),
    ),
  )

  it.instance("allow cannot cancel the prompt a hardened *.env read forces", () =>
    withProject(
      hookPlugin('    output.status = "allow"'),
      Effect.gen(function* () {
        const asking = yield* ask(request(allowRead, { permission: "read", patterns: ["project/.env"] })).pipe(
          Effect.forkScoped,
        )

        const pending = yield* waitForPending(1)
        expect(yield* hookRan).toBe("read")
        expect(pending[0]!.patterns).toEqual(["project/.env"])

        yield* reply({ requestID: pending[0]!.id, reply: "once" })
        expect(yield* Fiber.join(asking)).toEqual({ manual: true })
      }),
    ),
  )

  // Same permission, same `*.env` pattern, same hook as above — only the broad
  // allow rule is gone, so nothing had to be downgraded. `ReadPermission.harden`
  // marks the default `{ action: "ask" }` hardened all the same: what the hook
  // cannot relax is the file being a `.env`, not the shape of the rule that got
  // there. A hook that could auto-approve this read would be reading secrets on
  // an empty ruleset — the loosest configuration, not the strictest.
  it.instance("allow cannot cancel the prompt an unruled *.env read forces", () =>
    withProject(
      hookPlugin('    output.status = "allow"'),
      Effect.gen(function* () {
        const asking = yield* ask(request([], { permission: "read", patterns: ["project/.env"] })).pipe(
          Effect.forkScoped,
        )

        const pending = yield* waitForPending(1)
        expect(yield* hookRan).toBe("read")
        expect(pending[0]!.patterns).toEqual(["project/.env"])

        yield* reply({ requestID: pending[0]!.id, reply: "once" })
        expect(yield* Fiber.join(asking)).toEqual({ manual: true })
        expect(yield* list()).toEqual([])
      }),
    ),
  )

  // A config write `ConfigProtection.isRequest` matches, with no allow rule to
  // downgrade. The prompt is forced by the request being protected, not by a
  // rule the service had to rewrite — the metadata the request carries is the
  // proof it was recognised as one.
  it.instance("allow cannot cancel the prompt a protected config edit forces", () =>
    withProject(
      hookPlugin('    output.status = "allow"'),
      Effect.gen(function* () {
        const asking = yield* ask(request([], { permission: "edit", patterns: [".kilo/config.json"] })).pipe(
          Effect.forkScoped,
        )

        const pending = yield* waitForPending(1)
        expect(yield* hookRan).toBe("edit")
        expect(pending[0]!.patterns).toEqual([".kilo/config.json"])
        expect(pending[0]!.metadata).toEqual({
          [ConfigProtection.DISABLE_ALWAYS_KEY]: true,
          [ConfigProtection.CONFIG_PROTECTED_KEY]: true,
        })

        yield* reply({ requestID: pending[0]!.id, reply: "once" })
        expect(yield* Fiber.join(asking)).toEqual({ manual: true })
        expect(yield* list()).toEqual([])
      }),
    ),
  )

  // Prompting an existing Agent Manager session has an external side effect, so
  // `AgentManagerPermission.harden` hardens the ask whether it downgraded a
  // broad allow or found no rule at all — as here.
  it.instance("allow cannot cancel the prompt an agent_manager side effect forces", () =>
    withProject(
      hookPlugin('    output.status = "allow"'),
      Effect.gen(function* () {
        const asking = yield* ask(request([], { permission: "agent_manager", patterns: ["prompt"] })).pipe(
          Effect.forkScoped,
        )

        const pending = yield* waitForPending(1)
        expect(yield* hookRan).toBe("agent_manager")
        expect(pending[0]!.patterns).toEqual(["prompt"])

        yield* reply({ requestID: pending[0]!.id, reply: "once" })
        expect(yield* Fiber.join(asking)).toEqual({ manual: true })
        expect(yield* list()).toEqual([])
      }),
    ),
  )

  it.instance("a hook that throws leaves an auto-approving rule in charge", () =>
    withProject(
      hookPlugin('    throw new Error("hook exploded")'),
      Effect.gen(function* () {
        const outcome = yield* ask(request(allowBash))
        expect(outcome).toEqual({ manual: false, rule: { permission: "bash", pattern: "*", action: "allow" } })
        expect(yield* hookRan).toBe("bash")
        expect(yield* list()).toEqual([])
      }),
    ),
  )

  it.instance("a hook that throws leaves a rule that wanted to ask in charge", () =>
    withProject(
      hookPlugin('    throw new Error("hook exploded")'),
      Effect.gen(function* () {
        const asking = yield* ask(request([])).pipe(Effect.forkScoped)

        const pending = yield* waitForPending(1)
        expect(yield* hookRan).toBe("bash")

        yield* reply({ requestID: pending[0]!.id, reply: "once" })
        expect(yield* Fiber.join(asking)).toEqual({ manual: true })
      }),
    ),
  )

  // The hook mutates the very object the service reads back, so an allow written
  // on the way out has to be discarded along with the throw — otherwise a hook
  // could auto-approve by deciding and then failing.
  it.instance("an allow written before a hook throws is discarded, not honoured", () =>
    withProject(
      hookPlugin('    output.status = "allow"', '    throw new Error("hook exploded after deciding")'),
      Effect.gen(function* () {
        const asking = yield* ask(request([])).pipe(Effect.forkScoped)

        const pending = yield* waitForPending(1)
        expect(yield* hookRan).toBe("bash")

        yield* reply({ requestID: pending[0]!.id, reply: "once" })
        expect(yield* Fiber.join(asking)).toEqual({ manual: true })
      }),
    ),
  )

  // Every hook shares one mutable `output`, so the discard above has to be selective: a
  // throw arriving after a well-behaved earlier hook denied must not restore the pre-hook
  // status and hand the call back to the allow rule.
  it.instance("a hook that throws does not resurrect a denial an earlier hook made", () =>
    withPlugins(
      [
        markedHookPlugin(
          "denier-ran",
          '    output.status = "deny"',
          '    output.message = "blocked by the org policy plugin"',
        ),
        markedHookPlugin("thrower-ran", '    throw new Error("hook exploded")'),
      ],
      Effect.gen(function* () {
        const error = yield* fail(ask(request(allowBash)))
        expect(error).toBeInstanceOf(Permission.DeniedError)
        expect((error as Permission.DeniedError).reason).toBe("blocked by the org policy plugin")
        expect(yield* markerRan("denier-ran")).toBe("bash")
        expect(yield* markerRan("thrower-ran")).toBe("bash")
        expect(yield* list()).toEqual([])
      }),
    ),
  )

  // The mirror: what an earlier hook left is only worth keeping when it is at least as strict
  // as the rules were, so an allow written before a later hook throws is still thrown away.
  it.instance("a hook that throws discards an allow an earlier hook made", () =>
    withPlugins(
      [
        markedHookPlugin("allower-ran", '    output.status = "allow"'),
        markedHookPlugin("thrower-ran", '    throw new Error("hook exploded")'),
      ],
      Effect.gen(function* () {
        const asking = yield* ask(request([])).pipe(Effect.forkScoped)

        const pending = yield* waitForPending(1)
        expect(yield* markerRan("allower-ran")).toBe("bash")
        expect(yield* markerRan("thrower-ran")).toBe("bash")

        yield* reply({ requestID: pending[0]!.id, reply: "once" })
        expect(yield* Fiber.join(asking)).toEqual({ manual: true })
        expect(yield* list()).toEqual([])
      }),
    ),
  )
})
