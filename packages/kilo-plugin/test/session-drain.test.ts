import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Stream } from "effect"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { KiloSessionDrainRpc } from "@opencode/schema/kilocode/session-drain"
import { SessionID } from "@opencode/schema/session-id"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { offlineModels } from "../../core/test/fixture/models"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { KiloSessionDrain } from "../src/session-drain"

const llmLayer = TestLLM.testLayer()
const plugins = makeGlobalNode({
  service: SdkPlugins.Service,
  layer: Layer.effectDiscard(SdkPlugins.Service.use((sdk) => sdk.register(KiloSessionDrain.Plugin))).pipe(
    Layer.provideMerge(SdkPlugins.layer),
  ),
  deps: [Bus.node],
})
const it = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(LayerNode.group([Session.node, Job.node, LocationServiceMap.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      SdkPlugins.node.replace(plugins),
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llmLayer),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: () =>
            Effect.succeed(
              SessionRunnerModel.resolved(
                LanguageModel.make({ id: "drain", provider: "test", route: OpenAIChat.route }),
                {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  cost: [],
                  limit: { context: 200_000, output: 32_000 },
                },
              ),
            ),
        }),
      ),
    ]),
  ),
)

const model = Model.Ref.make({ id: Model.ID.make("drain"), providerID: Provider.ID.make("test") })

const directory = Effect.gen(function* () {
  const dir = yield* tmpdirScoped()
  yield* Effect.promise(() =>
    Bun.write(
      `${dir.path}/opencode.json`,
      JSON.stringify({
        agents: { reviewer: { mode: "subagent", system: "REVIEWER" } },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      }),
    ),
  )
  return AbsolutePath.make(dir.path)
})

const setup = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const locations = yield* LocationServiceMap.Service
  const root = yield* sessions.create({
    location: { directory: yield* directory },
    title: "Drain",
    agent: Agent.ID.make("build"),
    model,
  })
  const location = locations.get(root.location)
  yield* Plugin.Service.use((registry) => registry.awaitActivation).pipe(Effect.provide(location))
  const rpc = (yield* Rpc.Service.pipe(Effect.provide(location))).client(KiloSessionDrainRpc.Definition)
  const create = (parentID?: SessionID) =>
    parentID === undefined
      ? sessions.create({ location: root.location, title: "Other", agent: Agent.ID.make("build"), model })
      : sessions.create({ parentID, title: "Child", agent: Agent.ID.make("build"), model })
  return { sessions, rpc, root, create }
})

/** A reply that streams only after `gate` opens. */
const held = (gate: Deferred.Deferred<void>, text: string) =>
  Stream.fromEffect(Deferred.await(gate)).pipe(Stream.flatMap(() => Stream.fromIterable(TestLLM.text(text, text))))

/** A reply that never ends. It opens `started` once streaming, and interrupting it waits until `cleanup` opens. */
const hang = (started: Deferred.Deferred<void>, cleanup: Deferred.Deferred<void>) =>
  Stream.fromEffect(
    Deferred.succeed(started, undefined).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() => Deferred.await(cleanup)),
    ),
  )

/** Requests answered in arrival order. */
const replies = (...responses: TestLLM.Response[]) =>
  Effect.gen(function* () {
    const llm = yield* TestLLM.Test
    yield* llm.push(...responses)
    return llm
  })

const drain = (rpc: Effect.Success<typeof setup>["rpc"], sessionID: SessionID, token?: string) =>
  rpc
    .drain(token === undefined ? { sessionID } : { sessionID, token })
    .pipe(Effect.forkChild({ startImmediately: true }))

/** Lets a forked drain reach its wait, so a pending poll means it waits for work rather than for its first check. */
const pause = Effect.sleep("50 millis")

const finish = <A, E>(fiber: Fiber.Fiber<A, E>) => Fiber.join(fiber).pipe(Effect.timeout("10 seconds"))

describe("kilocode.session-drain", () => {
  it.live("waits for blocked foreground work and resolves when idle", () =>
    Effect.gen(function* () {
      const env = yield* setup
      expect(yield* env.rpc.drain({ sessionID: env.root.id })).toBe(true)
      const gate = yield* Deferred.make<void>()
      const llm = yield* replies(held(gate, "first"))
      yield* env.sessions.prompt({ sessionID: env.root.id, text: "Work" })
      yield* llm.wait(1)
      const waiting = yield* drain(env.rpc, env.root.id)
      yield* pause
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(gate, undefined)
      expect(yield* finish(waiting)).toBe(true)
      expect([...(yield* env.sessions.active)]).not.toContain(env.root.id)
    }),
  )

  it.live("waits for a coalesced follow-up run", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const first = yield* Deferred.make<void>()
      const second = yield* Deferred.make<void>()
      const llm = yield* replies(held(first, "first"), held(second, "second"))
      yield* env.sessions.prompt({ sessionID: env.root.id, text: "First" })
      yield* llm.wait(1)
      yield* env.sessions.prompt({ sessionID: env.root.id, text: "Second", delivery: "queue" })
      const waiting = yield* drain(env.rpc, env.root.id)
      yield* Deferred.succeed(first, undefined)
      yield* llm.wait(2)
      yield* pause
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(second, undefined)
      expect(yield* finish(waiting)).toBe(true)
      expect((yield* llm.requests()).length).toBe(2)
    }),
  )

  it.live("counts interrupted work as drained once its cleanup finishes", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const started = yield* Deferred.make<void>()
      const cleanup = yield* Deferred.make<void>()
      yield* replies(hang(started, cleanup))
      yield* env.sessions.prompt({ sessionID: env.root.id, text: "Hang" })
      yield* Deferred.await(started)
      const waiting = yield* drain(env.rpc, env.root.id)
      expect(yield* env.sessions.interrupt(env.root.id)).toBe(true)
      yield* pause
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(cleanup, undefined)
      expect(yield* finish(waiting)).toBe(true)
    }),
  )

  it.live("waits for a prompt admitted during slow interruption cleanup", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const started = yield* Deferred.make<void>()
      const cleanup = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const llm = yield* replies(hang(started, cleanup), held(gate, "successor"))
      yield* env.sessions.prompt({ sessionID: env.root.id, text: "Hang" })
      yield* Deferred.await(started)
      expect(yield* env.sessions.interrupt(env.root.id)).toBe(true)
      yield* env.sessions.prompt({ sessionID: env.root.id, text: "After the stop" })
      const waiting = yield* drain(env.rpc, env.root.id)
      yield* pause
      expect(waiting.pollUnsafe()).toBeUndefined()
      expect((yield* llm.requests()).length).toBe(1)
      yield* Deferred.succeed(cleanup, undefined)
      yield* llm.wait(2)
      yield* pause
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(gate, undefined)
      expect(yield* finish(waiting)).toBe(true)
    }),
  )

  it.live("a failed run neither holds nor poisons later drains", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const gate = yield* Deferred.make<void>()
      const llm = yield* replies(Stream.die(new Error("provider broke")), held(gate, "recovered"))
      yield* env.sessions.prompt({ sessionID: env.root.id, text: "Fail" })
      yield* llm.wait(1)
      expect(yield* env.rpc.drain({ sessionID: env.root.id })).toBe(true)
      yield* env.sessions.prompt({ sessionID: env.root.id, text: "Again" })
      yield* llm.wait(2)
      const waiting = yield* drain(env.rpc, env.root.id)
      yield* pause
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(gate, undefined)
      expect(yield* finish(waiting)).toBe(true)
    }),
  )

  it.live("is not blocked by an unrelated busy session", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const other = yield* env.create()
      const mine = yield* Deferred.make<void>()
      const theirs = yield* Deferred.make<void>()
      const llm = yield* replies(held(theirs, "other"), held(mine, "mine"))
      yield* env.sessions.prompt({ sessionID: other.id, text: "Other work" })
      yield* llm.wait(1)
      expect(yield* env.rpc.drain({ sessionID: env.root.id })).toBe(true)
      yield* env.sessions.prompt({ sessionID: env.root.id, text: "My work" })
      yield* llm.wait(2)
      const waiting = yield* drain(env.rpc, env.root.id)
      yield* Deferred.succeed(mine, undefined)
      expect(yield* finish(waiting)).toBe(true)
      expect([...(yield* env.sessions.active)]).toContain(other.id)
      yield* Deferred.succeed(theirs, undefined)
    }),
  )

  it.live("neither waits for nor promotes input admitted with resume: false", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const llm = yield* TestLLM.Test
      yield* env.sessions.prompt({ sessionID: env.root.id, text: "Later", resume: false })
      expect(yield* env.rpc.drain({ sessionID: env.root.id })).toBe(true)
      expect([...(yield* env.sessions.active)]).not.toContain(env.root.id)
      expect((yield* llm.requests()).length).toBe(0)
      expect(yield* env.sessions.inbox(env.root.id)).toHaveLength(1)
    }),
  )

  it.live("cancelling a drain request leaves the work running", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const gate = yield* Deferred.make<void>()
      const llm = yield* replies(held(gate, "kept"))
      yield* env.sessions.prompt({ sessionID: env.root.id, text: "Keep going" })
      yield* llm.wait(1)
      const waiting = yield* drain(env.rpc, env.root.id)
      yield* pause
      yield* Fiber.interrupt(waiting)
      expect([...(yield* env.sessions.active)]).toContain(env.root.id)
      yield* Deferred.succeed(gate, undefined)
      yield* env.sessions.wait(env.root.id)
      const messages = yield* env.sessions.messages({ sessionID: env.root.id, order: "asc" })
      expect(JSON.stringify(messages)).toContain("kept")
    }),
  )

  it.live("waits for a descendant that runs in another Location", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const child = yield* env.create(env.root.id)
      const grandchild = yield* env.create(child.id)
      const elsewhere = yield* directory
      yield* env.sessions.move({ sessionID: grandchild.id, directory: elsewhere })
      yield* env.sessions.wait(grandchild.id)
      expect((yield* env.sessions.get(grandchild.id)).location.directory).toBe(elsewhere)
      const gate = yield* Deferred.make<void>()
      const llm = yield* replies(held(gate, "grandchild"))
      yield* env.sessions.prompt({ sessionID: grandchild.id, text: "Work elsewhere" })
      yield* llm.wait(1)
      const waiting = yield* drain(env.rpc, env.root.id)
      yield* pause
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(gate, undefined)
      expect(yield* finish(waiting)).toBe(true)
    }),
  )

  it.live("waits for a child's background job until its notice is delivered", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const jobs = yield* Job.Service
      const child = yield* env.create(env.root.id)
      const done = yield* Deferred.make<void>()
      yield* jobs.start({
        id: "job_drain_shell",
        type: "shell",
        recovery: { kind: "shell", sessionID: child.id, shellID: "sh_drain", command: "sleep 1" },
        run: Deferred.await(done).pipe(Effect.as("slept")),
      })
      yield* jobs.background("job_drain_shell")
      const waiting = yield* drain(env.rpc, env.root.id)
      yield* pause
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(done, undefined)
      const settled = yield* jobs.wait({ id: "job_drain_shell" })
      expect(settled.info?.status).toBe("completed")
      yield* pause
      // The job has finished, but its notice has not reached the child yet.
      expect(waiting.pollUnsafe()).toBeUndefined()
      const notification = settled.info?.notificationID
      if (notification === undefined) throw new Error("background job has no notification")
      yield* jobs.completeBackground(notification)
      expect(yield* finish(waiting)).toBe(true)
    }),
  )

  it.live("waits for a background subagent and the follow-up its result wakes", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const llm = yield* TestLLM.Test
      const child = yield* Deferred.make<void>()
      const follow = yield* Deferred.make<void>()
      yield* llm.serve((request) => {
        const text = JSON.stringify(request)
        if (text.includes("REVIEWER")) return held(child, "child done")
        if (text.includes("<subagent")) return held(follow, "parent saw the result")
        if (text.includes("call_review")) return TestLLM.text("parent waits", "parent")
        return TestLLM.toolCall("call_review", "subagent", {
          agent: "reviewer",
          description: "Review",
          prompt: "Review it",
          background: true,
        })
      })
      yield* env.sessions.prompt({ sessionID: env.root.id, text: "Start a review" })
      yield* llm.wait(3)
      yield* env.sessions.wait(env.root.id)
      const waiting = yield* drain(env.rpc, env.root.id)
      yield* pause
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(child, undefined)
      yield* llm.wait(4)
      yield* pause
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(follow, undefined)
      expect(yield* finish(waiting)).toBe(true)
      const messages = yield* env.sessions.messages({ sessionID: env.root.id, order: "asc" })
      expect(JSON.stringify(messages)).toContain("parent saw the result")
    }),
  )

  // kilo_port(goals:ce1b66acd237) v1 checked the drain events in the event manifest; the RPC event carries the token.
  it.live("publishes the drained event with the caller's token before returning", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const received = yield* env.rpc.events
        .subscribe("drained")
        .pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }))
      yield* Effect.yieldNow
      expect(yield* env.rpc.drain({ sessionID: env.root.id, token: "token-1" })).toBe(true)
      const event = yield* finish(received)
      expect(Option.getOrUndefined(event)?.data).toEqual({ sessionID: env.root.id, token: "token-1" })
    }),
  )

  it.live("rejects an unknown session and an empty token", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const missing = yield* env.rpc.drain({ sessionID: SessionID.make("ses_missing") }).pipe(Effect.exit)
      expect(Exit.isFailure(missing) && JSON.stringify(missing.cause)).toContain("not_found")
      const empty = yield* env.rpc.drain({ sessionID: env.root.id, token: "" }).pipe(Effect.exit)
      expect(Exit.isFailure(empty) && JSON.stringify(empty.cause)).toContain("rpc.invalid_input")
    }),
  )
})
