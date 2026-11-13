import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { location } from "../../core/test/fixture/location"
import { testEffect } from "../../core/test/lib/effect"
import { harden, installPermission } from "../src/agent-manager/permission"

const SIDE_EFFECTS = ["prompt", "stop", "move", "answer"]
const broad: Permission.Ruleset = [{ action: "agent_manager", resource: "*", effect: "allow" }]

describe("Agent Manager side-effect permissions", () => {
  test("requires consent despite a broad Agent Manager allow rule", () => {
    for (const pattern of SIDE_EFFECTS) expect(harden("agent_manager", pattern, broad).effect).toBe("ask")
    expect(harden("agent_manager", "local", broad).effect).toBe("allow")
    expect(harden("agent_manager", "worktree", broad).effect).toBe("allow")
  })

  test("requires consent despite a global allow rule", () => {
    const rules: Permission.Ruleset = [{ action: "*", resource: "*", effect: "allow" }]
    for (const pattern of SIDE_EFFECTS) expect(harden("agent_manager", pattern, rules).effect).toBe("ask")
  })

  test("requires consent despite a saved wildcard approval", () => {
    const rules: Permission.Ruleset = [{ action: "agent_manager", resource: "*", effect: "ask" }, ...broad]
    for (const pattern of SIDE_EFFECTS) expect(harden("agent_manager", pattern, rules).effect).toBe("ask")
  })

  test("allows only explicit side-effect approvals", () => {
    const rules = SIDE_EFFECTS.map((resource) => ({ action: "agent_manager", resource, effect: "allow" as const }))
    for (const pattern of SIDE_EFFECTS) expect(harden("agent_manager", pattern, rules).effect).toBe("allow")
  })

  test("keeps an explicit approval behind a later wildcard, but not behind a later ask", () => {
    const exact = { action: "agent_manager", resource: "prompt", effect: "allow" as const }
    expect(harden("agent_manager", "prompt", [exact, ...broad]).effect).toBe("allow")
    expect(
      harden("agent_manager", "prompt", [exact, { action: "agent_manager", resource: "*", effect: "ask" }]).effect,
    ).toBe("ask")
  })

  test("leaves a deny and an unrelated action alone", () => {
    expect(harden("agent_manager", "prompt", [{ action: "agent_manager", resource: "*", effect: "deny" }]).effect).toBe(
      "deny",
    )
    expect(harden("edit", "prompt", broad).effect).toBe("ask")
  })
})

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionStore.node,
      PermissionSaved.node,
      Agent.node,
      PluginHooks.node,
      Permission.node,
    ]),
    [Location.node.replace(current)],
  ),
)
const first = Session.ID.make("ses_first")
const second = Session.ID.make("ses_second")

/** Two sessions of one project, the test agent with `rules`, and the Agent Manager hook as the plugin host wires it. */
function setup(rules: Permission.Ruleset = []) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    for (const id of [first, second])
      yield* db
        .insert(SessionTable)
        .values({
          id,
          project_id: Project.ID.global,
          slug: id,
          directory: "/project",
          title: id,
          version: "test",
          agent: Agent.ID.make("test"),
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("test"), (agent) => {
        agent.permissions = [...rules]
      }),
    )
    const hooks = yield* PluginHooks.Service
    yield* installPermission({ permission: { hook: (name, callback) => hooks.register("permission", name, callback) } })
  })
}

const request = (resource: string, sessionID = first) => ({
  id: Permission.ID.create(`per_${sessionID}_${resource}`),
  sessionID,
  action: "agent_manager",
  resources: [resource],
  save: [resource],
})

/** Starts an assert and waits until it is pending, as a tool call does. */
function pending(resource: string, sessionID = first) {
  return Effect.gen(function* () {
    const value = request(resource, sessionID)
    const bus = yield* Bus.Service
    const asked = yield* Deferred.make<void>()
    const unsubscribe = yield* bus.listen((event) =>
      event.type === Permission.Event.Asked.type && (event.data as Permission.Request).id === value.id
        ? Deferred.succeed(asked, undefined).pipe(Effect.asVoid)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const fiber = yield* (yield* Permission.Service).assert(value).pipe(Effect.forkScoped)
    yield* Deferred.await(asked)
    return { id: value.id, fiber }
  })
}

describe("Agent Manager permissions through the permission service", () => {
  it.effect("Always allow keeps an exact side-effect approval for every session of the project", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* Permission.Service
      const own = yield* pending("prompt")
      const other = yield* pending("prompt", second)
      const stop = yield* pending("stop", second)

      yield* service.reply({ requestID: own.id, reply: "always" })
      yield* Fiber.join(own.fiber)
      // The saved exact rule settles the same pattern pending in another session, not a different side effect.
      yield* Fiber.join(other.fiber)
      expect(yield* service.get(stop.id)).toBeDefined()

      expect(yield* service.ask(request("prompt"))).toMatchObject({ effect: "allow" })
      expect(yield* service.ask(request("prompt", second))).toMatchObject({ effect: "allow" })
      expect(yield* service.ask(request("move"))).toMatchObject({ effect: "ask" })
    }),
  )

  it.effect("asks again for side effects under a saved or configured wildcard", () =>
    Effect.gen(function* () {
      yield* setup(broad)
      const service = yield* Permission.Service
      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "agent_manager", resources: ["*"] })

      for (const resource of SIDE_EFFECTS)
        expect(yield* service.ask(request(resource))).toMatchObject({ effect: "ask" })
      expect(yield* service.ask(request("worktree"))).toMatchObject({ effect: "allow" })
      expect(yield* service.ask(request("overview"))).toMatchObject({ effect: "allow" })

      // An exact approval still decides when a wildcard was saved after it.
      yield* saved.add({ projectID: Project.ID.global, action: "agent_manager", resources: ["stop"] })
      expect(yield* service.ask(request("stop"))).toMatchObject({ effect: "allow" })
    }),
  )

  it.effect("denies an unapproved side effect in unattended work instead of settling it", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* Permission.Service
      const unattended = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provideService(Permission.Unattended, broad))

      const blocked = yield* unattended(service.assert(request("prompt"))).pipe(Effect.flip)
      expect(blocked).toBeInstanceOf(Permission.BlockedError)
      expect(blocked.message).toBe("Agent Manager prompt needs approval, and nobody is present to give it")
      expect(yield* unattended(service.ask(request("worktree")))).toMatchObject({ effect: "allow" })

      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "agent_manager", resources: ["prompt"] })
      expect(yield* unattended(service.ask(request("prompt")))).toMatchObject({ effect: "allow" })
    }),
  )
})
