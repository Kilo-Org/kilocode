import { describe, expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Schema } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { KiloPermissionsRpc } from "@opencode/schema/kilocode/permissions"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { location } from "../../core/test/fixture/location"
import { testEffect } from "../../core/test/lib/effect"
import { installPermissionSets } from "../src/permissions"

const root = AbsolutePath.make(mkdtempSync(path.join(tmpdir(), "kilo-permission-sets-")))
writeFileSync(
  path.join(root, "package.json"),
  JSON.stringify({ packageManager: "bun@1.4.4", devDependencies: { typescript: "5" } }),
)
writeFileSync(path.join(root, "tsconfig.json"), "{}")

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      FSUtil.node,
      SessionStore.node,
      PermissionSaved.node,
      Agent.node,
      PluginHooks.node,
      Rpc.node,
      Permission.node,
    ]),
    [Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(location({ directory: root }))))],
  ),
)

const sessionID = Session.ID.make("ses_permission_sets")
const projectID = Project.ID.make("prj_permission_sets")

function setup(
  input: {
    rules?: Permission.Ruleset
    flags?: string
    store?: Map<string, Schema.Json>
    projectID?: Project.ID
  } = {},
) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: root, sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "test",
        directory: root,
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
        agent.permissions = [...(input.rules ?? [])]
      }),
    )
    const hooks = yield* PluginHooks.Service
    const rpc = yield* Rpc.Service
    const store = input.store ?? new Map<string, Schema.Json>()
    const ctx = {
      location: { project: { id: input.projectID ?? projectID, directory: root, canonical: root } },
      storage: {
        get: (key: string) => Effect.sync(() => store.get(key)),
        set: (key: string, value: Schema.Json) => Effect.sync(() => void store.set(key, value)),
        remove: (key: string) => Effect.sync(() => void store.delete(key)),
      },
      permission: {
        hook: (name: "evaluate", callback: Parameters<Context["permission"]["hook"]>[1]) =>
          hooks.register("permission", name, callback),
      },
      rpc: { register: rpc.register },
    }
    yield* installPermissionSets(ctx).pipe(
      Effect.provide(Flag.testLayer([], { overrides: input.flags ?? "permission_setup" })),
    )
    return {
      store,
      hooks,
      call: (method: string, body: Record<string, unknown> = {}) => rpc.call("kilocode.permissions", method, body),
    }
  })
}

function shell(resources: string[], input: Partial<Permission.AssertInput> = {}): Permission.AssertInput {
  return { sessionID, action: "shell", resources, ...input }
}

describe("KiloPermissionsPlugin", () => {
  it.effect("allows covered shell asks once a set is applied and leaves everything else asking", () =>
    Effect.gen(function* () {
      const { call } = yield* setup()
      const permission = yield* Permission.Service
      expect(yield* permission.ask(shell(["bun run test"]))).toMatchObject({ effect: "ask" })
      yield* call("apply", { presetID: "typescript-checks" })
      expect(yield* permission.ask(shell(["bun run test"]))).toMatchObject({ effect: "allow" })
      expect(yield* permission.ask(shell(["bun run test", "git push"]))).toMatchObject({ effect: "ask" })
      expect(yield* permission.ask(shell(["echo x > .git/hooks/pre-commit"]))).toMatchObject({ effect: "ask" })
      expect(yield* permission.ask(shell(["bun install"]))).toMatchObject({ effect: "ask" })
      expect(yield* permission.ask(shell(["src/index.ts"], { action: "read" }))).toMatchObject({ effect: "ask" })
      expect(yield* call("list")).toMatchObject({
        decision: "accepted",
        applied: [{ id: "typescript-checks", resources: expect.arrayContaining(["bun run test *"]) }],
      })
    }),
  )

  it.effect("drops stored sets that no longer exist", () =>
    Effect.gen(function* () {
      const store = new Map<string, Schema.Json>([
        [
          `applied:${projectID}`,
          [
            { id: "typescript-install", resources: ["bun install *"] },
            { id: "typescript-checks", resources: ["bun run test *"] },
          ],
        ],
      ])
      const { call } = yield* setup({ store })
      const permission = yield* Permission.Service
      expect(yield* call("list")).toMatchObject({ applied: [{ id: "typescript-checks" }] })
      expect(yield* permission.ask(shell(["bun install"]))).toMatchObject({ effect: "ask" })
      expect(yield* permission.ask(shell(["bun run test"]))).toMatchObject({ effect: "allow" })
    }),
  )

  it.effect("keeps configured denies", () =>
    Effect.gen(function* () {
      const { call } = yield* setup({ rules: [{ action: "shell", resource: "*", effect: "deny" }] })
      yield* call("apply", { presetID: "typescript-checks" })
      const permission = yield* Permission.Service
      const blocked = yield* permission.assert(shell(["bun run test"])).pipe(Effect.flip)
      expect(blocked).toBeInstanceOf(Permission.BlockedError)
    }),
  )

  it.effect("leaves human-only requests and later hardening hooks in charge", () =>
    Effect.gen(function* () {
      const { call, hooks } = yield* setup()
      yield* call("apply", { presetID: "typescript-checks" })
      const permission = yield* Permission.Service
      expect(yield* permission.ask(shell(["bun run test"], { metadata: { interactive: true } }))).toMatchObject({
        effect: "ask",
      })
      yield* hooks.register("permission", "evaluate", (event) =>
        Effect.sync(() => {
          if (event.resources.includes("bun run lint")) event.effect = "ask"
        }),
      )
      expect(yield* permission.ask(shell(["bun run lint"]))).toMatchObject({ effect: "ask" })
    }),
  )

  it.effect("settles unattended runs like a saved approval: covered commands allow, others deny", () =>
    Effect.gen(function* () {
      const { call } = yield* setup()
      yield* call("apply", { presetID: "typescript-checks" })
      const permission = yield* Permission.Service
      const unattended = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provideService(Permission.Unattended, []))
      expect(yield* unattended(permission.ask(shell(["bun run test"])))).toMatchObject({ effect: "allow" })
      expect(yield* unattended(permission.ask(shell(["git push"])))).toMatchObject({ effect: "deny" })
    }),
  )

  it.effect("settles waiting requests the applied set covers and keeps the others pending", () =>
    Effect.gen(function* () {
      const { call } = yield* setup()
      const permission = yield* Permission.Service
      const bus = yield* Bus.Service
      const coveredID = Permission.ID.create("per_covered")
      const uncoveredID = Permission.ID.create("per_uncovered")
      const asked = yield* Deferred.make<void>()
      const seen = new Set<string>()
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type !== Permission.Event.Asked.type) return Effect.void
        seen.add((event.data as Permission.Request).id)
        return seen.size === 2 ? Deferred.succeed(asked, undefined).pipe(Effect.asVoid) : Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const covered = yield* permission.assert(shell(["bun run test"], { id: coveredID })).pipe(Effect.forkScoped)
      const uncovered = yield* permission.assert(shell(["bun install"], { id: uncoveredID })).pipe(Effect.forkScoped)
      yield* Deferred.await(asked)

      yield* call("apply", { presetID: "typescript-checks" })
      yield* Fiber.join(covered)
      expect((yield* permission.list()).map((request) => request.id)).toEqual([uncoveredID])

      yield* call("apply", { presetID: "dependency-install" })
      yield* Fiber.join(uncovered)
      expect(yield* permission.list()).toEqual([])
    }),
  )

  it.effect("leaves a waiting request pending when the sets cover only part of it", () =>
    Effect.gen(function* () {
      // The agent's own rule allows `git push`; a pending request does not say which agent asked, so applying a set
      // never settles a request on the strength of rules other than the set's own.
      const { call } = yield* setup({ rules: [{ action: "shell", resource: "git push", effect: "allow" }] })
      const permission = yield* Permission.Service
      const bus = yield* Bus.Service
      const requestID = Permission.ID.create("per_partial")
      const asked = yield* Deferred.make<void>()
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Deferred.succeed(asked, undefined).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* permission.assert(shell(["bun run test", "git push"], { id: requestID })).pipe(Effect.forkScoped)
      yield* Deferred.await(asked)

      yield* call("apply", { presetID: "typescript-checks" })
      expect((yield* permission.list()).map((request) => request.id)).toEqual([requestID])
      // A new request with the same parts is decided by the live evaluation, which sees the asking agent's rules.
      expect(yield* permission.ask(shell(["bun run test", "git push"]))).toMatchObject({ effect: "allow" })
    }),
  )

  it.effect("offers and applies nothing for the shared global project", () =>
    Effect.gen(function* () {
      const store = new Map<string, Schema.Json>([
        [`applied:${Project.ID.global}`, [{ id: "typescript-checks", resources: ["bun run test *"] }]],
      ])
      const { call } = yield* setup({ projectID: Project.ID.global, store })
      const permission = yield* Permission.Service
      expect(yield* call("list")).toMatchObject({ unidentified: true, presets: [], applied: [] })
      expect(yield* permission.ask(shell(["bun run test"]))).toMatchObject({ effect: "ask" })
      const failed = yield* call("apply", { presetID: "typescript-checks" }).pipe(Effect.flip)
      expect(failed).toMatchObject({ type: "not_applicable" })
      yield* call("skip")
      expect(store.has(`offer:${Project.ID.global}`)).toBe(false)
    }),
  )

  it.effect("resets the decision, and with all the applied sets, without touching saved grants", () =>
    Effect.gen(function* () {
      const { call } = yield* setup()
      const saved = yield* PermissionSaved.Service
      const permission = yield* Permission.Service
      yield* saved.add({ projectID: Project.ID.global, action: "shell", resources: ["make deploy"] })
      const before = yield* saved.list()
      yield* call("apply", { presetID: "typescript-checks" })

      expect(yield* call("reset", {})).toEqual({ removed: 0 })
      expect(yield* call("list")).toMatchObject({ decision: null, applied: [{ id: "typescript-checks" }] })

      const reset = (yield* call("reset", { all: true })) as { removed: number }
      expect(reset.removed).toBeGreaterThan(0)
      expect(yield* call("list")).toMatchObject({ decision: null, applied: [] })
      expect(yield* saved.list()).toEqual(before)
      expect(yield* permission.ask(shell(["bun run test"]))).toMatchObject({ effect: "ask" })
    }),
  )

  it.effect("clears the applied sets, records the offer as skipped and publishes the change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { call } = yield* setup()
        const rpc = yield* Rpc.Service
        const permission = yield* Permission.Service
        const updates = yield* rpc
          .client(KiloPermissionsRpc.Definition)
          .events.subscribe("updated")
          .pipe(
            Stream.map((event) => event.data),
            Stream.take(2),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          )
        yield* call("apply", { presetID: "typescript-checks" })
        yield* call("skip")
        expect(yield* call("list")).toMatchObject({ decision: "skipped", applied: [{ id: "typescript-checks" }] })

        yield* call("clear")
        expect(yield* call("list")).toMatchObject({ decision: "skipped", applied: [] })
        expect(yield* permission.ask(shell(["bun run test"]))).toMatchObject({ effect: "ask" })
        expect(yield* Fiber.join(updates)).toMatchObject([
          { projectID, applied: [{ id: "typescript-checks" }] },
          { projectID, applied: [] },
        ])
      }),
    ),
  )

  it.effect("ignores applied sets and refuses changes while the flag is off", () =>
    Effect.gen(function* () {
      const store = new Map<string, Schema.Json>([
        [`applied:${projectID}`, [{ id: "typescript-checks", resources: ["bun run test *"] }]],
      ])
      const { call } = yield* setup({ flags: "-permission_setup", store })
      const permission = yield* Permission.Service
      expect(yield* permission.ask(shell(["bun run test"]))).toMatchObject({ effect: "ask" })
      expect(yield* call("list")).toMatchObject({ enabled: false, presets: [] })
      const failed = yield* call("apply", { presetID: "typescript-checks" }).pipe(Effect.flip)
      expect(failed).toMatchObject({ type: "unavailable" })
    }),
  )
})
