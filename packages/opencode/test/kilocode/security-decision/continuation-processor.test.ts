// kilocode_change - new file
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import path from "path"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { LLM } from "@/session/llm"
import { SessionProcessor } from "@/session/processor"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { LLMEvent } from "@opencode-ai/llm"
import { SecurityBlocked } from "@/kilocode/security-decision/block"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const ref = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }

const cfg = {
  experimental: { continue_loop_on_deny: true },
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
    },
  },
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const scenario = { count: 4, dismissed: false }
const toolCallLLM = Layer.succeed(LLM.Service, LLM.Service.of({
  stream: () => Stream.fromIterable([
    LLMEvent.stepStart({ index: 0 }),
    ...Array.from({ length: scenario.count }, (_, index) => {
      const id = `call-${index}`
      return [
        LLMEvent.toolInputStart({ id, name: "bash" }),
        LLMEvent.toolInputEnd({ id, name: "bash" }),
        LLMEvent.toolCall({ id, name: "bash", input: { command: `blocked-${index}` }, providerExecuted: true }),
        LLMEvent.toolError({ id, name: "bash", message: "blocked", error: SecurityBlocked.of("SEC.V1.CONTROL_PLANE_WRITE", {} as never) }),
      ]
    }).flat(),
    ...(scenario.dismissed ? [
      LLMEvent.toolInputStart({ id: "dismissed", name: "suggest" }),
      LLMEvent.toolInputEnd({ id: "dismissed", name: "suggest" }),
      LLMEvent.toolCall({ id: "dismissed", name: "suggest", input: {}, providerExecuted: true }),
      LLMEvent.toolResult({ id: "dismissed", name: "suggest", result: { type: "json", value: { output: "dismissed", metadata: { dismissed: true } } }, providerExecuted: true }),
    ] : []),
    LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
    LLMEvent.finish({ reason: "tool-calls" }),
  ]),
}))

const root = LayerNode.group([
  SessionProcessor.node,
  Session.node,
  SessionProjector.node,
  Provider.node,
  Database.node,
  EventV2Bridge.node,
  SessionStatus.node,
  CrossSpawnSpawner.node,
])

const env = LayerNode.compile(root, [
  [SessionSummary.node, summary],
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
  [LLM.node, toolCallLLM],
])

const it = testEffect(env)

const user = Effect.fn("TestSession.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({ id: PartID.ascending(), messageID: msg.id, sessionID, type: "text", text })
  return msg
})

const assistant = Effect.fn("TestSession.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  dir: string,
) {
  const session = yield* Session.Service
  const msg: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: dir, root: dir },
    cost: 0,
    tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  yield* session.updateMessage(msg)
  return msg
})


for (const [count, dismissed] of [[2, false], [3, false], [4, false], [4, true]] as const) {
  it.live(`SecurityContinuation -> processor: ${count} distinct blocks, dismissed=${dismissed}`, () => provideTmpdirInstance((dir) => Effect.gen(function* () {
    scenario.count = count
    scenario.dismissed = dismissed
    const processors = yield* SessionProcessor.Service
    const session = yield* Session.Service
    const provider = yield* Provider.Service
    const chat = yield* session.create({})
    const parent = yield* user(chat.id, "run tests")
    const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
    const model = yield* provider.getModel(ref.providerID, ref.modelID)
    const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model })
    const result = yield* handle.process({
      user: { id: parent.id, sessionID: chat.id, role: "user", time: parent.time, agent: parent.agent, model: ref } satisfies SessionV1.User,
      sessionID: chat.id, model, agent: { name: "build" } as never,
      system: [], messages: [{ role: "user", content: "run tests" }], tools: {},
    })
    expect(result).toBe(count >= 3 ? "stop" : "continue")
    for (let index = 0; index < count; index++) expect(handle.securityBlocked("bash", { command: `blocked-${index}` })).toBe(true)
  }), { config: () => cfg }))
}
