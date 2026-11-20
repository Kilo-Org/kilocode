import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTable } from "@opencode/core/session/sql"
import { Document, Event as ConfigEvent, type Entry } from "@opencode/schema/config"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
// `Config.testLayer` keeps this array by reference, so a test can change the effective config in place.
const configEntries: Entry[] = []
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionStore.node,
      PermissionSaved.node,
      Agent.node,
      Config.node,
      Permission.node,
    ]),
    [Location.node.replace(current), Config.node.replace(Config.testLayer(configEntries))],
  ),
)

function setup(autoApprove = false, rules: Permission.Ruleset = []) {
  return Effect.gen(function* () {
    configEntries.splice(0, configEntries.length)
    if (autoApprove)
      configEntries.push(
        new Document({ type: "document", info: new KiloConfigPolicy.Info({ auto_approve: true }) }),
      )
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: Session.ID.make("ses_test"),
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
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
  })
}

function assertion(input: Partial<Permission.AssertInput> = {}) {
  return {
    id: Permission.ID.create("per_test"),
    sessionID: Session.ID.make("ses_test"),
    action: "read",
    resources: ["src/index.ts"],
    ...input,
  } satisfies Permission.AssertInput
}

function waitForRequest() {
  return Effect.gen(function* () {
    const value = assertion()
    const service = yield* Permission.Service
    const bus = yield* Bus.Service
    const asked = yield* Deferred.make<Permission.Request>()
    const unsubscribe = yield* bus.listen((event) => {
      if (event.type !== Permission.Event.Asked.type) return Effect.void
      const request = event.data as Permission.Request
      return request.id === value.id ? Deferred.succeed(asked, request).pipe(Effect.asVoid) : Effect.void
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const fiber = yield* service.assert(value).pipe(Effect.forkScoped)
    const request = yield* Deferred.await(asked)
    return { service, fiber, request }
  })
}

describe("Permission auto-approve", () => {
  it.effect("allows a request that would otherwise ask", () =>
    Effect.gen(function* () {
      yield* setup(true)
      const service = yield* Permission.Service
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "allow" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("keeps an explicit deny", () =>
    Effect.gen(function* () {
      yield* setup(true, [{ action: "read", resource: "*", effect: "deny" }])
      const service = yield* Permission.Service
      const blocked = yield* service.assert(assertion()).pipe(Effect.flip)
      expect(blocked).toBeInstanceOf(Permission.BlockedError)
    }),
  )

  it.effect("leaves an interactive request for a person", () =>
    Effect.gen(function* () {
      yield* setup(true)
      const service = yield* Permission.Service
      expect(yield* service.ask(assertion({ metadata: { interactive: true } }))).toMatchObject({ effect: "ask" })
      expect(yield* service.list()).toHaveLength(1)
    }),
  )

  it.effect("settles a waiting request when auto-approve turns on", () =>
    Effect.gen(function* () {
      yield* setup()
      const pending = yield* waitForRequest()
      yield* setup(true)
      const bus = yield* Bus.Service
      yield* bus.publish(ConfigEvent.Updated, {})
      yield* Fiber.join(pending.fiber)
      expect(yield* pending.service.list()).toEqual([])
    }),
  )
})
