import { describe, expect } from "bun:test"
import { Effect, Layer, Option, Schema } from "effect"
import { LanguageModel, type LLMRequest } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { KV } from "@opencode/core/kv"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Goal } from "@opencode/schema/goal"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { offlineModels } from "../../core/test/fixture/models"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { KiloGoal } from "../src/goal"

const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("Working on it", "work") })
const plugins = makeGlobalNode({
  service: SdkPlugins.Service,
  layer: Layer.effectDiscard(SdkPlugins.Service.use((sdk) => sdk.register(KiloGoal.Plugin))).pipe(
    Layer.provideMerge(SdkPlugins.layer),
  ),
  deps: [Bus.node],
})
const it = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(LayerNode.group([Session.node, LocationServiceMap.node, Job.node, KV.node]), [
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
                LanguageModel.make({ id: "goal", provider: "test", route: OpenAIChat.route }),
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

const model = Model.Ref.make({ id: Model.ID.make("goal"), providerID: Provider.ID.make("test") })
const REVIEW_MARKER = "You are now the reviewer for the session's goal"

describe("kilocode.goal tool", () => {
  it.live("lets the agent start a goal that the reviewer then continues and completes", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const reviews: string[] = [
        '{"verdict":"continue","reason":"Tests still fail."}',
        '{"verdict":"done","reason":"All tests pass."}',
      ]
      let calls = 0
      yield* serve((request) => {
        if (last(request).includes(REVIEW_MARKER))
          return TestLLM.text(reviews.shift() ?? '{"verdict":"done","reason":"Out of script."}', "review")
        if (calls === 0 && !last(request).includes("Goal active")) {
          calls++
          return TestLLM.toolCall("call-goal", "goal", { action: "start", objective: "Make the tests pass" })
        }
        return TestLLM.text("Working on it", "work")
      })

      yield* sessions.prompt({ sessionID: session.id, text: "Keep going until the tests pass." })
      yield* sessions.wait(session.id)

      expect(yield* goal(session.id)).toMatchObject({
        objective: "Make the tests pass",
        status: "complete",
        reason: "All tests pass.",
        rounds: 1,
      })
    }),
  )

  it.live("refuses a second goal while one is active", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      yield* setGoal(session.id, {
        id: "existing",
        objective: "Ship the release",
        status: "active",
        rounds: 0,
        maxRounds: 50,
        boot: "another-process",
        updatedAt: 0,
      })
      const results: string[] = []
      let called = false
      yield* serve((request) => {
        if (last(request).includes(REVIEW_MARKER))
          return TestLLM.text('{"verdict":"paused","reason":"Stop."}', "review")
        if (!called) {
          called = true
          return TestLLM.toolCall("call-goal", "goal", { action: "start", objective: "Something else" })
        }
        results.push(JSON.stringify(request.messages))
        return TestLLM.text("Done", "work")
      })

      yield* sessions.prompt({ sessionID: session.id, text: "Start another goal." })
      yield* sessions.wait(session.id)

      expect(results.join("\n")).toContain("a goal is already active")
      expect((yield* goal(session.id))?.objective).toBe("Ship the release")
    }),
  )

  it.live("resumes a complete goal with its saved objective", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      yield* setGoal(session.id, {
        id: "saved",
        objective: "Ship the release",
        status: "complete",
        reason: "Released.",
        rounds: 3,
        maxRounds: 50,
        boot: "another-process",
        updatedAt: 0,
      })
      let called = false
      yield* serve((request) => {
        if (last(request).includes(REVIEW_MARKER))
          return TestLLM.text('{"verdict":"done","reason":"Shipped again."}', "review")
        if (called) return TestLLM.text("Done", "work")
        called = true
        return TestLLM.toolCall("call-goal", "goal", { action: "resume" })
      })

      yield* sessions.prompt({ sessionID: session.id, text: "Pick the goal back up." })
      yield* sessions.wait(session.id)

      expect(yield* goal(session.id)).toMatchObject({
        id: "saved",
        objective: "Ship the release",
        status: "complete",
        reason: "Shipped again.",
      })
    }),
  )

  it.live("refuses a goal in a delegated session", () =>
    Effect.gen(function* () {
      const parent = yield* project()
      const sessions = yield* Session.Service
      const child = yield* sessions.create({ parentID: parent.id, agent: Agent.ID.make("build"), model })
      const results: string[] = []
      let called = false
      yield* serve((request) => {
        if (called) {
          results.push(JSON.stringify(request.messages))
          return TestLLM.text("Done", "work")
        }
        called = true
        return TestLLM.toolCall("call-goal", "goal", { action: "start", objective: "Do it all" })
      })

      yield* sessions.prompt({ sessionID: child.id, text: "Start a goal." })
      yield* sessions.wait(child.id)

      expect(results.join("\n")).toContain("Start goals from the main session, not a delegated session.")
      expect(yield* goal(child.id)).toBeUndefined()
    }),
  )

  it.live("sets a control word as the objective after the -- delimiter", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      yield* serve((request) =>
        last(request).includes(REVIEW_MARKER)
          ? TestLLM.text('{"verdict":"done","reason":"Paused things."}', "review")
          : TestLLM.text("Done", "work"),
      )

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "-- pause" })
      yield* sessions.wait(session.id)

      expect(yield* goal(session.id)).toMatchObject({ objective: "pause", status: "complete" })
    }),
  )
})

function last(request: LLMRequest) {
  return JSON.stringify(request.messages.at(-1))
}

function serve(respond: (request: LLMRequest) => TestLLM.Response) {
  return TestLLM.Test.use((llm) => llm.serve(respond))
}

const goals = KV.Service.use((kv) => Effect.succeed(PluginHost.storage(kv, KiloGoal.Plugin.id)))
const decodeGoal = Schema.decodeUnknownOption(Goal.State)

function goal(sessionID: Session.ID) {
  return goals.pipe(
    Effect.flatMap((storage) => storage.get(`session:${sessionID}`)),
    Effect.map((value) => Option.getOrUndefined(decodeGoal(value))),
  )
}

function setGoal(sessionID: Session.ID, state: Goal.State) {
  return goals.pipe(Effect.flatMap((storage) => storage.set(`session:${sessionID}`, state)))
}

function project() {
  return Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      Bun.write(
        `${tmp.path}/opencode.json`,
        JSON.stringify({
          // The Kilo host removes the native goal plugin the same way.
          plugins: ["-opencode.goal"],
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        }),
      ),
    )
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      location: { directory: AbsolutePath.make(tmp.path) },
      title: "Goal session",
      agent: Agent.ID.make("build"),
      model,
    })
    const locations = yield* LocationServiceMap.Service
    yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
      Effect.provide(locations.get(session.location)),
    )
    return session
  })
}
