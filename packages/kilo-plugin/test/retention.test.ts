import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { ConfigDiscovery } from "@opencode/core/config/discovery"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { KiloConfigDiscovery } from "@opencode/core/kilocode/config/discovery"
import { KV } from "@opencode/core/kv"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { KiloRetentionRpc } from "@opencode/schema/kilocode/retention"
import { SessionID } from "@opencode/schema/session-id"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { offlineModels } from "../../core/test/fixture/models"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { KiloSessionRetention } from "../src/retention"
import { KiloRetention } from "../src/retention/retention"

const llmLayer = TestLLM.testLayer()
// The host provides the session store to Kilo plugins; the test registers the plugin the same way.
const plugins = makeGlobalNode({
  service: SdkPlugins.Service,
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      const store = yield* SessionStore.Service
      yield* sdk.register({
        id: KiloSessionRetention.Plugin.id,
        effect: (ctx) => KiloSessionRetention.Plugin.effect(ctx).pipe(Effect.provideService(SessionStore.Service, store)),
      })
    }),
  ).pipe(Layer.provideMerge(SdkPlugins.layer)),
  deps: [Bus.node, SessionStore.node],
})
const it = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(LayerNode.group([Session.node, SessionStore.node, Database.node, KV.node, Job.node, LocationServiceMap.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      ConfigDiscovery.node.replace(Layer.succeed(ConfigDiscovery.LayoutService, KiloConfigDiscovery.layout)),
      SdkPlugins.node.replace(plugins),
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llmLayer),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: () =>
            Effect.succeed(
              SessionRunnerModel.resolved(LanguageModel.make({ id: "retention", provider: "test", route: OpenAIChat.route }), {
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                cost: [],
                limit: { context: 200_000, output: 32_000 },
              }),
            ),
        }),
      ),
    ]),
  ),
)

const model = Model.Ref.make({ id: Model.ID.make("retention"), providerID: Provider.ID.make("test") })
const DAY = KiloRetention.DAY_MS

const setup = (retention?: { enabled?: boolean; maxAgeDays?: number }) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      Bun.write(
        `${dir.path}/kilo2.json`,
        JSON.stringify({ permissions: [{ action: "*", resource: "*", effect: "allow" }], ...(retention ? { retention } : {}) }),
      ),
    )
    const sessions = yield* Session.Service
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const location = { directory: AbsolutePath.make(dir.path) }
    const create = (input: { parentID?: SessionID; title: string }) =>
      input.parentID === undefined
        ? sessions.create({ location, title: input.title, agent: Agent.ID.make("build"), model })
        : sessions.create({ parentID: input.parentID, title: input.title, agent: Agent.ID.make("build"), model })
    const first = yield* create({ title: "Anchor" })
    const services = locations.get(first.location)
    yield* Plugin.Service.use((registry) => registry.awaitActivation).pipe(Effect.provide(services))
    const rpc = (yield* Rpc.Service.pipe(Effect.provide(services))).client(KiloRetentionRpc.Definition)
    const config = yield* Config.Service.pipe(Effect.provide(services))
    const exists = (id: SessionID) => store.get(id).pipe(Effect.map((row) => row !== undefined))
    const database = yield* Database.Service
    // Ages every session that exists so far. A TestClock jump of weeks would fire every periodic timer in the graph
    // for the whole span, which is slow and leaves sessions unable to run afterwards.
    const age = (days: number) =>
      database.db
        .update(SessionTable)
        .set({ time_updated: Date.now() - days * DAY })
        .run()
        .pipe(Effect.orDie)
    return { sessions, store, rpc, create, exists, first, config, age }
  })

/** A reply that streams only after `gate` opens, so the session stays active until then. */
const held = (gate: Deferred.Deferred<void>, text: string) =>
  Stream.fromEffect(Deferred.await(gate)).pipe(Stream.flatMap(() => Stream.fromIterable(TestLLM.text(text, text))))

describe("kilocode.retention", () => {
  it.live("deletes expired session trees and skips active ones", () =>
    Effect.gen(function* () {
      const env = yield* setup({ enabled: true, maxAgeDays: 30 })
      const old = yield* env.create({ title: "Old" })
      const oldChild = yield* env.create({ parentID: old.id, title: "Old child" })
      const running = yield* env.create({ title: "Running" })
      const claimed = yield* env.create({ title: "Claimed elsewhere" })
      const resumed = yield* env.create({ title: "Old with a fresh fork" })

      const gate = yield* Deferred.make<void>()
      const llm = yield* TestLLM.Test
      yield* llm.push(held(gate, "busy"))
      yield* env.sessions.prompt({ sessionID: running.id, text: "Work" })
      yield* llm.wait(1)
      // An execution claim is what another backend on the machine writes while it runs a session.
      yield* env.store.claim(claimed.id)

      yield* env.age(31)
      const started = Date.now()
      const fresh = yield* env.create({ title: "Fresh" })
      const fork = yield* env.create({ parentID: resumed.id, title: "Fresh fork" })
      expect([...(yield* env.sessions.active)]).toContain(running.id)

      const status = yield* env.rpc.run({})
      expect(status.policy).toEqual({ enabled: true, maxAgeDays: 30 })
      expect(status.progress).toBeUndefined()
      expect(status.last?.at).toBeGreaterThanOrEqual(started)
      expect(status.last).toMatchObject({
        // The anchor from setup is old too, and has no activity.
        scanned: 8,
        deleted: 3,
        skippedActive: 2,
        failed: 0,
      })
      expect(status.last?.cancelled).toBeUndefined()

      expect(yield* env.exists(old.id)).toBe(false)
      expect(yield* env.exists(oldChild.id)).toBe(false)
      expect(yield* env.exists(env.first.id)).toBe(false)
      for (const id of [running.id, claimed.id, resumed.id, fork.id, fresh.id]) expect(yield* env.exists(id)).toBe(true)
      expect([...(yield* env.sessions.active)]).toContain(running.id)

      // The result survives as the last run.
      expect((yield* env.rpc.status({})).last).toEqual(status.last)
      yield* Deferred.succeed(gate, undefined)
    }),
  )

  it.live("keeps an old chat while one of its subagents is running", () =>
    Effect.gen(function* () {
      const env = yield* setup({ enabled: true, maxAgeDays: 30 })
      const parent = yield* env.create({ title: "Old chat" })
      const child = yield* env.create({ parentID: parent.id, title: "Running subagent" })
      const gate = yield* Deferred.make<void>()
      const llm = yield* TestLLM.Test
      yield* llm.push(held(gate, "busy"))
      yield* env.sessions.prompt({ sessionID: child.id, text: "Work" })
      yield* llm.wait(1)
      yield* env.age(31)

      const status = yield* env.rpc.run({})
      // Only the idle anchor from setup goes; the chat and its running subagent stay.
      expect(status.last).toMatchObject({ scanned: 3, deleted: 1, skippedActive: 2, failed: 0 })
      expect(yield* env.exists(parent.id)).toBe(true)
      expect(yield* env.exists(child.id)).toBe(true)
      expect([...(yield* env.sessions.active)]).toContain(child.id)
      yield* Deferred.succeed(gate, undefined)
    }),
  )

  it.live("a disabled policy never deletes, even when forced", () =>
    Effect.gen(function* () {
      const env = yield* setup({ maxAgeDays: 1 })
      yield* env.age(2)
      const forced = yield* env.rpc.run({ force: true })
      expect(forced).toEqual({ policy: { enabled: false, maxAgeDays: 1 } })
      expect(yield* env.rpc.run({})).toEqual(forced)
      expect(yield* env.exists(env.first.id)).toBe(true)
    }),
  )

  it.live("an absent policy uses the defaults and stays off", () =>
    Effect.gen(function* () {
      const env = yield* setup()
      yield* env.age(60)
      expect(yield* env.rpc.run({ force: true })).toEqual({ policy: { enabled: false, maxAgeDays: 30 } })
      expect(yield* env.exists(env.first.id)).toBe(true)
    }),
  )

  it.effect("a scheduled pass waits out the spacing window; a forced pass does not", () =>
    Effect.gen(function* () {
      const env = yield* setup({ enabled: true, maxAgeDays: 1 })
      yield* TestClock.adjust(`${1.5 * DAY} millis`)
      const later = yield* env.create({ title: "Expires after the first pass" })
      yield* TestClock.adjust(`${0.5 * DAY} millis`)
      const first = yield* env.rpc.run({})
      expect(first.last).toMatchObject({ at: 2 * DAY, scanned: 2, deleted: 1 })
      expect(yield* env.exists(later.id)).toBe(true)

      // Twelve hours later the session is expired, but the last pass is less than 23 hours old.
      yield* TestClock.adjust(`${0.5 * DAY} millis`)
      expect(yield* env.rpc.run({})).toEqual(first)
      expect(yield* env.exists(later.id)).toBe(true)

      const forced = yield* env.rpc.run({ force: true })
      expect(forced.last).toMatchObject({ at: 2.5 * DAY, scanned: 1, deleted: 1 })
      expect(yield* env.exists(later.id)).toBe(false)
    }),
  )

  // The engine with the plugin's own store wiring; only removal waits on a gate, so a pass can be held mid-flight.
  const gated = Effect.gen(function* () {
    const env = yield* setup({ enabled: true, maxAgeDays: 30 })
    const roots = yield* Effect.forEach([1, 2, 3], (index) => env.create({ title: `Old ${index}` }))
    yield* env.age(31)
    const real = KiloSessionRetention.deps({
      store: env.store,
      sessions: env.sessions,
      config: env.config,
      storage: PluginHost.storage(yield* KV.Service, "kilocode.retention.test"),
    })
    const reached = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const removed: SessionID[] = []
    const deps: KiloRetention.Deps = {
      ...real,
      remove: (sessionID) =>
        Effect.gen(function* () {
          removed.push(sessionID)
          if (removed.length === 2) {
            yield* Deferred.succeed(reached, undefined)
            yield* Deferred.await(release)
          }
          yield* real.remove(sessionID)
        }),
    }
    return { env, deps, roots, reached, release, removed, engine: KiloRetention.make(), scope: yield* Scope.Scope }
  })

  it.live("cancel stops a pass mid-flight and records the partial result", () =>
    Effect.gen(function* () {
      const pass = yield* gated
      const running = yield* pass.engine.run(pass.deps, {}, pass.scope).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(pass.reached)
      // Four expired roots (the anchor is the oldest); the first is gone, the second is being removed.
      expect(pass.engine.progress()).toEqual({
        phase: "deleting",
        total: 4,
        processed: 1,
        deleted: 1,
        failed: 0,
        skippedActive: 0,
      })
      expect(pass.engine.cancel()).toBe(true)
      expect(pass.engine.progress()?.phase).toBe("cancelling")
      yield* Deferred.succeed(pass.release, undefined)

      const status = yield* Fiber.join(running)
      expect(status.progress).toBeUndefined()
      expect(status.last).toMatchObject({ scanned: 4, deleted: 2, failed: 0, skippedActive: 0, cancelled: true })
      expect(pass.removed).toHaveLength(2)
      const left = yield* Effect.filter(pass.roots, (root) => pass.env.exists(root.id))
      expect(left).toHaveLength(2)
      // Nothing runs any more, so there is nothing to cancel.
      expect(pass.engine.cancel()).toBe(false)
      expect((yield* pass.engine.status(pass.deps)).last).toEqual(status.last)
    }),
  )

  it.live("skips a session that starts running while the pass is under way", () =>
    Effect.gen(function* () {
      const pass = yield* gated
      const running = yield* pass.engine.run(pass.deps, {}, pass.scope).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(pass.reached)

      // The user reopens the last expired chat after the scan selected it, before its turn to be removed.
      const late = pass.roots[2]
      const gate = yield* Deferred.make<void>()
      const llm = yield* TestLLM.Test
      yield* llm.push(held(gate, "resumed"))
      yield* pass.env.sessions.prompt({ sessionID: late.id, text: "Back to this" })
      yield* llm.wait(1)
      yield* Deferred.succeed(pass.release, undefined)

      const status = yield* Fiber.join(running)
      expect(status.last).toMatchObject({ scanned: 4, deleted: 3, skippedActive: 1, failed: 0 })
      expect(pass.removed).not.toContain(late.id)
      expect(yield* pass.env.exists(late.id)).toBe(true)
      expect([...(yield* pass.env.sessions.active)]).toContain(late.id)
      yield* Deferred.succeed(gate, undefined)
    }),
  )

  it.live("status shows live progress, and a run while a pass is in flight joins it", () =>
    Effect.gen(function* () {
      const pass = yield* gated
      const first = yield* pass.engine.run(pass.deps, {}, pass.scope).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(pass.reached)
      const second = yield* pass.engine
        .run(pass.deps, { force: true }, pass.scope)
        .pipe(Effect.forkChild({ startImmediately: true }))
      const live = yield* pass.engine.status(pass.deps)
      expect(live.last).toBeUndefined()
      expect(live.progress).toMatchObject({ phase: "deleting", total: 4, deleted: 1 })
      expect(second.pollUnsafe()).toBeUndefined()

      yield* Deferred.succeed(pass.release, undefined)
      const [a, b] = [yield* Fiber.join(first), yield* Fiber.join(second)]
      expect(a).toEqual(b)
      expect(a.last).toMatchObject({ deleted: 4, failed: 0 })
      expect(a.last?.cancelled).toBeUndefined()
      // One pass removed each root once.
      expect(pass.removed).toHaveLength(4)
      expect(new Set(pass.removed).size).toBe(4)
    }),
  )
})

describe("retention selection", () => {
  const now = 100 * DAY
  const id = (value: string) => SessionID.make(`ses_${value}`)
  const row = (value: string, age: number, parent?: string) => ({
    id: id(value),
    parentID: parent === undefined ? undefined : id(parent),
    updated: now - age * DAY,
  })
  const pick = (rows: ReturnType<typeof row>[], busy: string[] = []) => {
    const selection = KiloRetention.select(rows, { maxAgeDays: 30, busy: new Set(busy.map(id)), now })
    return { roots: selection.trees.map((tree): string => tree.root.slice(4)), skipped: selection.skipped }
  }

  test("expires at the boundary and keeps a session just inside it", () => {
    expect(pick([row("old", 30), row("inside", 29.999), row("fresh", 1)])).toEqual({ roots: ["old"], skipped: 0 })
  })

  test("judges a tree by its freshest session and deletes only its top", () => {
    // A fresh fork or subagent keeps the whole tree, old siblings included.
    expect(pick([row("a", 90), row("a1", 60, "a"), row("a2", 2, "a"), row("a11", 80, "a1")]).roots).toEqual([])
    expect(pick([row("b", 90), row("b1", 60, "b"), row("b11", 80, "b1")]).roots).toEqual(["b"])
  })

  test("holds back a whole old tree when any session in it is busy", () => {
    expect(pick([row("c", 90), row("c1", 60, "c"), row("d", 40)], ["c1"])).toEqual({ roots: ["d"], skipped: 2 })
  })

  test("orders trees oldest first", () => {
    expect(pick([row("young", 31), row("oldest", 99), row("middle", 50)]).roots).toEqual(["oldest", "middle", "young"])
  })

  test("a child whose parent row is missing is its own tree, and a cycle does not loop", () => {
    expect(pick([row("orphan", 40, "gone")]).roots).toEqual(["orphan"])
    expect(pick([row("x", 40, "y"), row("y", 40, "x")]).roots.toSorted()).toEqual(["x", "y"])
  })

  test("the policy is off at 30 days by default and ignores invalid ages", () => {
    expect(KiloRetention.policy({})).toEqual({ enabled: false, maxAgeDays: 30 })
    expect(KiloRetention.policy({ enabled: true, maxAgeDays: 7 })).toEqual({ enabled: true, maxAgeDays: 7 })
    for (const maxAgeDays of [0, -1, 1.5, Number.NaN]) expect(KiloRetention.policy({ maxAgeDays }).maxAgeDays).toBe(30)
  })

  test("only an enabled policy runs, and only a forced pass skips the spacing", () => {
    const on = { enabled: true, maxAgeDays: 30 }
    const last = { at: now - KiloRetention.MIN_SPACING_MS + 1, scanned: 0, deleted: 0, skippedActive: 0, failed: 0, durationMs: 0 }
    expect(KiloRetention.shouldRun({ ...on, enabled: false }, { force: true }, undefined, now)).toEqual({ ok: false, reason: "disabled" })
    expect(KiloRetention.shouldRun(on, {}, last, now)).toEqual({ ok: false, reason: "recent" })
    expect(KiloRetention.shouldRun(on, { force: true }, last, now)).toEqual({ ok: true })
    expect(KiloRetention.shouldRun(on, {}, { ...last, at: now - KiloRetention.MIN_SPACING_MS }, now)).toEqual({ ok: true })
    expect(KiloRetention.shouldRun(on, {}, undefined, now)).toEqual({ ok: true })
  })
})
