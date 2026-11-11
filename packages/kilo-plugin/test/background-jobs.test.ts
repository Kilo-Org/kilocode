import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Schedule } from "effect"
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
import { Tool } from "@opencode/core/tool"
import { KiloBackgroundJobsRpc } from "@opencode/schema/kilocode/background-jobs"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { offlineModels } from "../../core/test/fixture/models"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { executeTool, toolIdentity } from "../../core/test/lib/tool"
import { KiloBackgroundJobs } from "../src/background-jobs"
import { KiloSubagentBackgroundPlugin } from "../src/subagent-background"

const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("Review complete", "review") })
const plugins = makeGlobalNode({
  service: SdkPlugins.Service,
  layer: Layer.effectDiscard(
    SdkPlugins.Service.use((sdk) =>
      Effect.gen(function* () {
        yield* sdk.register(KiloBackgroundJobs.Plugin)
        yield* sdk.register(KiloSubagentBackgroundPlugin)
      }),
    ),
  ).pipe(Layer.provideMerge(SdkPlugins.layer)),
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
                LanguageModel.make({ id: "review", provider: "test", route: OpenAIChat.route }),
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

const setup = Effect.gen(function* () {
  const dir = yield* tmpdirScoped()
  yield* Effect.promise(() =>
    Bun.write(
      `${dir.path}/opencode.json`,
      JSON.stringify({
        agents: { reviewer: { mode: "subagent" } },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      }),
    ),
  )
  const sessions = yield* Session.Service
  const locations = yield* LocationServiceMap.Service
  const parent = yield* sessions.create({
    location: { directory: AbsolutePath.make(dir.path) },
    agent: Agent.ID.make("build"),
    model: Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") }),
  })
  const location = locations.get(parent.location)
  yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(location))
  const registry = yield* Tool.Service.pipe(Effect.provide(location))
  const rpc = (yield* Rpc.Service.pipe(Effect.provide(location))).client(KiloBackgroundJobsRpc.Definition)
  const run = (input: Record<string, unknown>) =>
    executeTool(registry, {
      sessionID: parent.id,
      ...toolIdentity,
      call: { type: "tool-call", id: `call-${Math.random()}`, name: "subagent", input },
    })
  const list = rpc.list({ sessionID: parent.id }).pipe(Effect.map((result) => result.jobs))
  const until = (check: (jobs: readonly KiloBackgroundJobsRpc.Job[]) => boolean) =>
    list.pipe(
      Effect.flatMap((jobs) => (check(jobs) ? Effect.succeed(jobs) : Effect.fail("pending"))),
      Effect.retry({ times: 400, schedule: Schedule.spaced("10 millis") }),
    )
  return { parent, rpc, run, list, until }
})

describe("kilocode.background-jobs", () => {
  it.live("lists a foreground subagent and continues it in the background", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const llm = yield* TestLLM.Test
      const gate = yield* llm.gate()
      const call = yield* env
        .run({
          agent: "reviewer",
          description: "Review fixture",
          prompt: "Review the fixture",
          background: false,
        })
        .pipe(Effect.forkChild)
      yield* gate.started
      const running = yield* env.until((jobs) => jobs.length === 1)
      expect(running[0]).toMatchObject({
        parentSessionID: env.parent.id,
        agent: "reviewer",
        title: "Review fixture",
        status: "running",
        background: false,
      })
      expect(running[0]?.id).toBe(running[0]?.sessionID)

      expect(yield* env.rpc.promote({ jobID: running[0]!.id })).toBe(true)
      const result = yield* Fiber.join(call)
      expect(result.status).toBe("completed")
      expect(yield* env.list).toMatchObject([{ status: "running", background: true }])

      yield* gate.release
      const done = yield* env.until((jobs) => jobs[0]?.status === "completed")
      expect(done[0]?.time.completed).toBeNumber()
      // Promoting a finished job changes nothing.
      expect(yield* env.rpc.promote({ jobID: running[0]!.id })).toBe(false)
    }),
  )

  it.live("records a foreground subagent that finishes in its tool call", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const result = yield* env.run({
        agent: "reviewer",
        description: "Quick review",
        prompt: "Review it",
        background: false,
      })
      expect(result.status).toBe("completed")
      expect(yield* env.list).toMatchObject([{ title: "Quick review", status: "completed", background: false }])
    }),
  )

  // Both modes cancel the child the same way; the tracker learns from the tool result when it waited, and from the
  // Job registry when the call already returned.
  for (const background of [true, false])
    it.live(`records a subagent cancelled outside the RPC as cancelled (background: ${background})`, () =>
      Effect.gen(function* () {
        const env = yield* setup
        const llm = yield* TestLLM.Test
        const jobs = yield* Job.Service
        const gate = yield* llm.gate()
        const call = yield* env
          .run({ agent: "reviewer", description: "Cancelled review", prompt: "Review it", background })
          .pipe(Effect.forkChild)
        yield* gate.started
        const running = yield* env.until((list) => list[0]?.status === "running")
        yield* jobs.cancel(running[0]!.id)
        const result = yield* Fiber.join(call)
        expect(background ? result.output?.status : result.status).toBe(background ? "running" : "error")
        yield* env.until((list) => list[0]?.status === "cancelled")
        yield* gate.release
      }),
    )

  it.live("runs a subagent call that omits background in the background", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const llm = yield* TestLLM.Test
      const gate = yield* llm.gate()
      const result = yield* env.run({ agent: "reviewer", description: "Defaulted review", prompt: "Review it" })
      expect(result.output?.status).toBe("running")
      yield* gate.started
      const running = yield* env.until((jobs) => jobs[0]?.status === "running")
      expect(running[0]).toMatchObject({ title: "Defaulted review", background: true })
      yield* gate.release
      yield* env.until((jobs) => jobs[0]?.status === "completed")
    }),
  )

  it.live("stops a background subagent", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const llm = yield* TestLLM.Test
      const gate = yield* llm.gate()
      const result = yield* env.run({
        agent: "reviewer",
        description: "Long review",
        prompt: "Review everything",
        background: true,
      })
      expect(result.status).toBe("completed")
      yield* gate.started
      const running = yield* env.until((jobs) => jobs[0]?.status === "running")
      expect(running[0]?.background).toBe(true)

      expect(yield* env.rpc.cancel({ jobID: running[0]!.id })).toBe(true)
      yield* env.until((jobs) => jobs[0]?.status === "cancelled")
      yield* gate.release
    }),
  )

  it.live("rejects unknown jobs", () =>
    Effect.gen(function* () {
      const env = yield* setup
      const cancel = yield* env.rpc.cancel({ jobID: "ses_missing" }).pipe(Effect.flip)
      expect(cancel).toMatchObject({ type: "not_found" })
      const promote = yield* env.rpc.promote({ jobID: "ses_missing" }).pipe(Effect.flip)
      expect(promote).toMatchObject({ type: "not_found" })
      expect(yield* env.list).toEqual([])
    }),
  )
})
