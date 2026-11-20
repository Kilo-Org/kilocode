import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Rpc } from "@opencode/core/rpc"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTable } from "@opencode/core/session/sql"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Document, Event, type Entry } from "@opencode/schema/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { location } from "../../core/test/fixture/location"
import { testEffect } from "../../core/test/lib/effect"
import { installPermission } from "../src/agent-manager/permission"
import { installAutoApprove, autoApproveState, isAutoApproveEnabled } from "../src/auto-approve"

const resolveIdentity = (file: string) => Effect.succeed(file)
const document = (value?: boolean, file?: string) =>
  new Document({
    type: "document",
    ...(file ? { path: AbsolutePath.make(file) } : {}),
    info: new KiloConfigPolicy.Info(value === undefined ? {} : { auto_approve: value }),
  })

describe("autoApproveState", () => {
  test("resolves effective state across all loaded global and non-global documents", async () => {
    const state = (entries: Entry[], resolve = resolveIdentity) =>
      Effect.runPromise(autoApproveState(entries, "/global", resolve))
    const enabled = (entries: Entry[], resolve = resolveIdentity) =>
      Effect.runPromise(isAutoApproveEnabled(entries, "/global", resolve))

    expect(await state([])).toBe("disabled")
    expect(await state([document(true, "/global/kilo2.json")])).toBe("enabled")
    // A lower-precedence global true remains enabled when a higher-precedence global file omits the key.
    expect(await state([document(true, "/global/kilo2.json"), document(undefined, "/global/kilo2.jsonc")])).toBe(
      "enabled",
    )
    expect(await state([document(true, "/global/kilo2.json"), document(false, "/global/kilo2.jsonc")])).toBe("disabled")
    expect(await state([document(true, "/project/kilo2.json")])).toBe("disabled")
    expect(await state([document(true, "/global/kilo2.json"), document(false, "/project/kilo2.json")])).toBe("narrowed")
    // A lower-precedence project false still narrows even when a nearer project file omits the key or sets true.
    expect(
      await state([
        document(true, "/global/kilo2.json"),
        document(false, "/project/.kilo2/kilo2.json"),
        document(undefined, "/project/sub/kilo2.json"),
      ]),
    ).toBe("narrowed")
    expect(
      await state([
        document(true, "/global/kilo2.json"),
        document(false, "/project/kilo2.json"),
        document(true, "/project/sub/kilo2.json"),
      ]),
    ).toBe("narrowed")
    expect(await state([document(false, "/global/kilo2.json"), document(true, "/project/kilo2.json")])).toBe("disabled")
    expect(await state([document(true)])).toBe("disabled")
    expect(await state([document(true, "/global/kilo2.json"), document(false)])).toBe("narrowed")
    expect(await enabled([document(true, "/global/kilo2.json"), document(false, "/project/kilo2.json")])).toBe(false)
    // Symlinked roots resolve before comparison (for example /tmp -> /private/tmp on macOS).
    expect(
      await state([document(true, "/private/global/kilo2.json")], (file) =>
        Effect.succeed(file.startsWith("/global") ? `/private${file}` : file),
      ),
    ).toBe("enabled")
  })
})

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const globalLayer = Layer.succeed(Global.Service, Global.Service.of(Global.make({ config: "/global" })))
const entries: Entry[] = []
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      FSUtil.node,
      Global.node,
      Config.node,
      SessionStore.node,
      PermissionSaved.node,
      Agent.node,
      PluginHooks.node,
      Rpc.node,
      Permission.node,
    ]),
    [Location.node.replace(current), Global.node.replace(globalLayer), Config.node.replace(Config.testLayer(entries))],
  ),
)

const sessionID = Session.ID.make("ses_auto_approve_plugin")

function setup(initial: Entry[] = [], rules: Permission.Ruleset = []) {
  return Effect.gen(function* () {
    entries.splice(0, entries.length, ...initial)
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
        id: sessionID,
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
    const hooks = yield* PluginHooks.Service
    const rpc = yield* Rpc.Service
    const bus = yield* Bus.Service
    const ctx = {
      permission: {
        hook: (name: "evaluate", callback: Parameters<Context["permission"]["hook"]>[1]) =>
          hooks.register("permission", name, callback),
      },
      rpc: {
        register: rpc.register,
      },
      event: {
        subscribe: () => bus.subscribe(Event.Updated),
      },
    }
    yield* installAutoApprove(ctx)
    return { ctx, rpcGet: () => rpc.call("kilocode.auto-approve", "get", {}) }
  })
}

function assertion(input: Partial<Permission.AssertInput> = {}): Permission.AssertInput {
  return {
    id: Permission.ID.create("per_test"),
    sessionID,
    action: "read",
    resources: ["src/index.ts"],
    ...input,
  }
}

describe("KiloAutoApprovePlugin", () => {
  it.effect("reports effective enabled, narrowed and disabled state through its RPC", () =>
    Effect.gen(function* () {
      const { rpcGet } = yield* setup([])
      expect(yield* rpcGet()).toEqual({ state: "disabled" })
      entries.splice(0, entries.length, document(true, "/global/kilo2.json"))
      expect(yield* rpcGet()).toEqual({ state: "enabled" })
      entries.push(document(false, "/project/.kilo2/kilo2.json"))
      expect(yield* rpcGet()).toEqual({ state: "narrowed" })
    }),
  )

  it.effect("allows an ordinary ask when global auto_approve is on", () =>
    Effect.gen(function* () {
      yield* setup([document(true, "/global/kilo2.json")])
      const permission = yield* Permission.Service
      expect(yield* permission.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "allow" })
      expect(yield* permission.list()).toEqual([])
    }),
  )

  it.effect("ignores a project config trying to enable auto_approve", () =>
    Effect.gen(function* () {
      yield* setup([document(true, "/project/kilo2.json")])
      const permission = yield* Permission.Service
      expect(yield* permission.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "ask" })
      expect(yield* permission.list()).toHaveLength(1)
    }),
  )

  it.effect("keeps an explicit configured deny", () =>
    Effect.gen(function* () {
      yield* setup([document(true, "/global/kilo2.json")], [{ action: "read", resource: "*", effect: "deny" }])
      const permission = yield* Permission.Service
      const blocked = yield* permission.assert(assertion()).pipe(Effect.flip)
      expect(blocked).toBeInstanceOf(Permission.BlockedError)
    }),
  )

  it.effect("leaves human-only interactive requests for a person", () =>
    Effect.gen(function* () {
      yield* setup([document(true, "/global/kilo2.json")])
      const permission = yield* Permission.Service
      expect(yield* permission.ask(assertion({ metadata: { interactive: true } }))).toMatchObject({ effect: "ask" })
      expect(yield* permission.list()).toHaveLength(1)
    }),
  )

  it.effect("does not widen unattended automation rules", () =>
    Effect.gen(function* () {
      yield* setup([document(true, "/global/kilo2.json")])
      const permission = yield* Permission.Service
      const result = yield* permission
        .ask(assertion({ action: "shell", resources: ["rm -rf /tmp/x"] }))
        .pipe(Effect.provideService(Permission.Unattended, []))
      expect(result).toMatchObject({ effect: "deny" })
    }),
  )

  it.effect("lets hardening hooks registered after it still require approval", () =>
    Effect.gen(function* () {
      const { ctx } = yield* setup([document(true, "/global/kilo2.json")])
      yield* installPermission(ctx)
      const permission = yield* Permission.Service
      expect(
        yield* permission.ask(assertion({ action: "agent_manager", resources: ["prompt"] })),
      ).toMatchObject({ effect: "ask" })
    }),
  )

  it.effect("drains waiting ordinary requests when auto_approve turns on and keeps interactive ones pending", () =>
    Effect.gen(function* () {
      yield* setup([])
      const permission = yield* Permission.Service
      const bus = yield* Bus.Service
      const ordinaryID = Permission.ID.create("per_ordinary")
      const interactiveID = Permission.ID.create("per_interactive")
      const ordinaryAsked = yield* Deferred.make<void>()
      const interactiveAsked = yield* Deferred.make<void>()
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type !== Permission.Event.Asked.type) return Effect.void
        const request = event.data as Permission.Request
        if (request.id === ordinaryID) return Deferred.succeed(ordinaryAsked, undefined).pipe(Effect.asVoid)
        if (request.id === interactiveID) return Deferred.succeed(interactiveAsked, undefined).pipe(Effect.asVoid)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)

      const ordinaryFiber = yield* permission.assert(assertion({ id: ordinaryID })).pipe(Effect.forkScoped)
      const interactiveFiber = yield* permission
        .assert(assertion({ id: interactiveID, metadata: { interactive: true } }))
        .pipe(Effect.forkScoped)
      yield* Deferred.await(ordinaryAsked)
      yield* Deferred.await(interactiveAsked)

      entries.splice(0, entries.length, document(true, "/global/kilo2.json"))
      yield* bus.publish(Event.Updated, {})
      yield* Fiber.join(ordinaryFiber)

      const remaining = yield* permission.list()
      expect(remaining.map((item) => item.id)).toEqual([interactiveID])
      yield* Fiber.interrupt(interactiveFiber)
    }),
  )
})
