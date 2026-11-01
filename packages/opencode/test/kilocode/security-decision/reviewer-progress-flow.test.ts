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
import { MessageV2 } from "@/session/message-v2"
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
import { PermissionProvenance } from "@/kilocode/permission/provenance"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

/**
 * The reviewer's progress reaches a client, not just the caller.
 *
 * `KiloSecurityGate` emits a `running` audit before the model call (proven in gate.test.ts), but
 * that only matters if the record actually lands on the live tool part and is published. A tool
 * part's metadata is only updated in place while the call is `running` — otherwise the write is
 * buffered until the call registers — so this walks the real processor: a registered, running tool
 * call, two metadata writes, and the events a client would receive.
 */

const ref = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }

const cfg = {
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

/**
 * A turn that registers one tool call and then pauses inside it, which is exactly where a
 * permission ask — and the reviewer stage inside it — happens. `probe` runs there, with the call
 * registered and still `running`.
 */
const probe: { run: Effect.Effect<void> } = { run: Effect.void }

const toolCallLLM = Layer.succeed(
  LLM.Service,
  LLM.Service.of({
    stream: () =>
      Stream.make(
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolInputStart({ id: "call-1", name: "bash" }),
        LLMEvent.toolInputEnd({ id: "call-1", name: "bash" }),
        LLMEvent.toolCall({ id: "call-1", name: "bash", input: { command: "npm test" }, providerExecuted: true }),
      ).pipe(
        Stream.concat(Stream.drain(Stream.fromEffect(Effect.suspend(() => probe.run)))),
        Stream.concat(
          Stream.make(
            LLMEvent.toolResult({
              id: "call-1",
              name: "bash",
              result: { type: "text", value: "ok" },
              providerExecuted: true,
            }),
            LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
            LLMEvent.finish({ reason: "tool-calls" }),
          ),
        ),
      ),
  }),
)

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

function audit(state: string, enforcement: string, extra: Record<string, unknown> = {}) {
  return {
    metadata: {
      [PermissionProvenance.SECURITY_KEY]: {
        schema: "kilo.security-decision/v1",
        rule_id: "SEC.V1.UNCLASSIFIED_EXEC",
        reason: "SEC.V1.UNCLASSIFIED_EXEC",
        decision: "ask",
        reviewer: { state, ...extra },
        final_enforcement: enforcement,
      },
    },
  }
}

/** Every `securityDecision.reviewer.state` a client would observe, in the order it arrives. */
function states(events: Array<{ type: string; data: unknown }>) {
  const out: string[] = []
  for (const event of events) {
    if (event.type !== MessageV2.Event.PartUpdated.type) continue
    const part = (event.data as { part?: SessionV1.Part }).part
    if (!part || part.type !== "tool" || part.state.status !== "running") continue
    const record = part.state.metadata?.[PermissionProvenance.SECURITY_KEY] as { reviewer?: { state?: string } }
    if (record?.reviewer?.state) out.push(record.reviewer.state)
  }
  return out
}

it.live("a reviewer verdict is published as its own part update, after the running one", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const processors = yield* SessionProcessor.Service
        const session = yield* Session.Service
        const provider = yield* Provider.Service
        const events = yield* EventV2Bridge.Service

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "run the tests")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const model = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model })

        const seen: Array<{ type: string; data: unknown }> = []
        const off = yield* events.listen((event) =>
          Effect.sync(() => void seen.push({ type: event.type, data: event.data })),
        )

        // What a client had already received by the time the verdict was written.
        let midflight: string[] = []
        probe.run = Effect.gen(function* () {
          yield* handle.metadata("call-1", audit("running", "ask_pending"))
          midflight = states(seen)
          yield* handle.metadata(
            "call-1",
            audit("allow", "allow", { reason_code: "ORDINARY_DEV_COMMAND", latency_ms: 42 }),
          )
        })

        yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model,
          agent: { name: "build" } as never,
          system: [],
          messages: [{ role: "user", content: "run the tests" }],
          tools: {},
        })
        yield* off

        // The running record reached the wire on its own, before any verdict existed.
        expect(midflight).toEqual(["running"])
        expect(states(seen)).toEqual(["running", "allow"])
      }),
    { config: () => cfg },
  ),
)
