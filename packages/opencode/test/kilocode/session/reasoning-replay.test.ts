import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { tool, type ModelMessage } from "ai"
import { Effect, Layer } from "effect"
import path from "path"
import z from "zod"
import type { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { KiloReasoningReplay } from "@/kilocode/session/reasoning-replay"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { SessionProcessor } from "@/session/processor"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { provideTmpdirServer } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import { raw, TestLLMServer } from "../../lib/llm-server"

// Synthetic stand-ins for opaque provider values. Never use real signatures here.
const text = { type: "reasoning.text", text: "Need to look up the weather.", format: "google-gemini-v1", index: 0 }
const encrypted = {
  type: "reasoning.encrypted",
  data: "synthetic-opaque-signature",
  id: "tool_call_1",
  format: "google-gemini-v1",
  index: 1,
}

describe("KiloReasoningReplay.details", () => {
  test("distinguishes absent metadata from an explicit empty array", () => {
    expect(KiloReasoningReplay.details(undefined)).toBeUndefined()
    expect(KiloReasoningReplay.details({ openrouter: { usage: { cost: 1 } } })).toBeUndefined()
    expect(KiloReasoningReplay.details({ anthropic: { reasoning_details: [text] } })).toBeUndefined()
    expect(KiloReasoningReplay.details({ openrouter: { reasoning_details: [] } })).toEqual([])
  })

  test("detaches from the live provider array and drops undefined fields", () => {
    const live: Record<string, unknown>[] = [{ ...encrypted, signature: undefined }]
    const result = KiloReasoningReplay.details({ openrouter: { reasoning_details: live } })
    live.push(text)
    expect(result).toStrictEqual([encrypted])
  })
})

describe("KiloReasoningReplay.reconcile", () => {
  const sessionID = SessionID.make("ses_replay")
  const messageID = MessageID.make("msg_replay")
  const base = () => ({ id: PartID.ascending(), sessionID, messageID })
  const start = (): SessionV1.Part => ({ ...base(), type: "step-start" })
  const reasoning = (metadata?: Record<string, unknown>): SessionV1.ReasoningPart => ({
    ...base(),
    type: "reasoning",
    text: "thinking",
    time: { start: 1, end: 2 },
    metadata,
  })
  const call = (id: string, metadata?: Record<string, unknown>): SessionV1.ToolPart => ({
    ...base(),
    type: "tool",
    tool: "lookup",
    callID: id,
    state: {
      status: "completed",
      input: { query: id },
      output: "ok",
      title: "lookup",
      metadata: { source: "tool" },
      time: { start: 1, end: 2 },
    },
    metadata,
  })

  test("updates only replay parts of the latest step and preserves unrelated metadata", () => {
    const old = call("old", { openrouter: { reasoning_details: [] } })
    const first = call("first", {
      providerExecuted: true,
      openrouter: { reasoning_details: [text], extra: "keep" },
      other: { keep: true },
    })
    const second = call("second")
    const think = reasoning({ openrouter: { reasoning_details: [text] } })
    const parts = [start(), old, start(), think, first, second]

    const result = KiloReasoningReplay.reconcile({ parts, details: [text, encrypted], messageID, sessionID })

    expect(result.map((part) => part.id)).toEqual([think.id, first.id])
    expect(result[0]).toStrictEqual({ ...think, metadata: { openrouter: { reasoning_details: [text, encrypted] } } })
    expect(result[1]).toStrictEqual({
      ...first,
      metadata: {
        providerExecuted: true,
        openrouter: { reasoning_details: [text, encrypted], extra: "keep" },
        other: { keep: true },
      },
    })
  })

  test("adds an empty reasoning part for encrypted-only steps", () => {
    const parts = [start(), { ...base(), type: "text", text: "answer" } satisfies SessionV1.Part]
    const result = KiloReasoningReplay.reconcile({ parts, details: [encrypted], messageID, sessionID })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: "reasoning",
      text: "",
      messageID,
      sessionID,
      metadata: { openrouter: { reasoning_details: [encrypted] } },
    })
    expect(result[0].id > parts[1].id).toBe(true)
  })

  test("does nothing when stored state already matches or nothing was reported", () => {
    const parts = [start(), reasoning({ openrouter: { reasoning_details: [encrypted] } }), call("a")]
    expect(KiloReasoningReplay.reconcile({ parts, details: [encrypted], messageID, sessionID })).toEqual([])
    expect(KiloReasoningReplay.reconcile({ parts: [start()], details: [], messageID, sessionID })).toEqual([])
    expect(KiloReasoningReplay.reconcile({ parts: [start(), reasoning()], details: [], messageID, sessionID })).toEqual(
      [],
    )
  })

  test("restores stripped tool state metadata from the stored part", () => {
    const stored = call("edit", { openrouter: { reasoning_details: [text] } })
    if (stored.state.status !== "completed") throw new Error("expected completed tool")
    stored.state.metadata = { filediff: { file: "a.ts", before: "old", after: "new" } }
    const read = { ...stored, state: { ...stored.state, metadata: { filediff: { file: "a.ts" } } } }
    const [next] = KiloReasoningReplay.reconcile({
      parts: [start(), read],
      details: [text, encrypted],
      messageID,
      sessionID,
    })

    expect(KiloReasoningReplay.restore(next, stored)).toStrictEqual({
      ...stored,
      metadata: { openrouter: { reasoning_details: [text, encrypted] } },
    })
    // A newly created part has nothing stored yet.
    const [created] = KiloReasoningReplay.reconcile({ parts: [start()], details: [encrypted], messageID, sessionID })
    expect(KiloReasoningReplay.restore(created, undefined)).toBe(created)
  })
})

// ---------------------------------------------------------------------------
// End to end: real OpenRouter AI SDK provider -> processor -> storage -> next request
// ---------------------------------------------------------------------------

const ref = {
  providerID: ProviderV2.ID.make("openrouter"),
  modelID: ModelV2.ID.make("google/gemini-3-pro-preview"),
}

const config = (url: string) => ({
  provider: {
    openrouter: {
      name: "OpenRouter",
      id: "openrouter",
      env: [],
      npm: "@openrouter/ai-sdk-provider",
      models: {
        [ref.modelID]: {
          id: ref.modelID,
          name: "Gemini",
          attachment: false,
          reasoning: true,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: url },
    },
  },
})

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionProcessor.node,
      Session.node,
      SessionProjector.node,
      Provider.node,
      Database.node,
      EventV2Bridge.node,
      SessionStatus.node,
      CrossSpawnSpawner.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
    [
      [SessionSummary.node, summary],
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
    ],
  ),
)

const agent: Agent.Info = {
  name: "build",
  mode: "primary",
  options: {},
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
}

const tools = {
  lookup: tool({
    description: "Look up information",
    inputSchema: z.object({ query: z.string() }),
    // filediff before/after is stripped by the read model but must stay in storage.
    execute: async (input) => ({
      title: "Lookup",
      output: `result:${input.query}`,
      metadata: { source: "test", filediff: { file: "a.ts", before: "old", after: "new" } },
    }),
  }),
}

const chunk = (delta: Record<string, unknown>, finish?: string) => ({
  id: "gen-test",
  object: "chat.completion.chunk",
  created: 0,
  model: ref.modelID,
  choices: [{ index: 0, delta, ...(finish ? { finish_reason: finish } : {}) }],
  ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } : {}),
})

const user = Effect.fn("ReasoningReplayTest.user")(function* (sessionID: SessionID, value: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({ id: PartID.ascending(), messageID: msg.id, sessionID, type: "text", text: value })
  return msg
})

// Runs one processor turn against the test server with history rebuilt from storage,
// exactly like the prompt loop does before each request.
const turn = Effect.fn("ReasoningReplayTest.turn")(function* (input: {
  sessionID: SessionID
  parent: SessionV1.User
  dir: string
}) {
  const session = yield* Session.Service
  const processors = yield* SessionProcessor.Service
  const provider = yield* Provider.Service
  const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
  const messages: ModelMessage[] = yield* MessageV2.toModelMessagesEffect(
    yield* MessageV2.filterCompactedEffect(input.sessionID),
    mdl,
  )
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    sessionID: input.sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: input.dir, root: input.dir },
    cost: 0,
    tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID: input.parent.id,
    time: { created: Date.now() },
  } satisfies SessionV1.Assistant)
  const handle = yield* processors.create({ assistantMessage: msg, sessionID: input.sessionID, model: mdl })
  const result = yield* handle.process({
    user: input.parent,
    sessionID: input.sessionID,
    model: mdl,
    agent,
    system: [],
    messages,
    tools,
  } satisfies LLM.StreamInput)
  return { result, msg }
})

type Wire = { role: string; reasoning_details?: unknown; tool_calls?: unknown[] }

const wire = (body: Record<string, unknown> | undefined, role: string): Wire[] =>
  (Array.isArray(body?.messages) ? body.messages : []).filter((message) => message.role === role)

// `tail` is only streamed after `gate` sees the early part persisted, reproducing the
// network gap between the early event and the later chunk carrying the signature.
const replay = Effect.fn("ReasoningReplayTest.replay")(function* (input: {
  dir: string
  head: unknown[]
  tail: unknown[]
  gate: (part: (typeof MessageV2.Event.PartUpdated.data.Type)["part"]) => boolean
  follow?: string
}) {
  const llm = yield* TestLLMServer
  const session = yield* Session.Service
  const events = yield* EventV2Bridge.Service
  const ready = Promise.withResolvers<void>()
  const off = yield* events.listen((evt) => {
    if (evt.type !== MessageV2.Event.PartUpdated.type) return Effect.void
    const data = evt.data as typeof MessageV2.Event.PartUpdated.data.Type
    if (input.gate(data.part)) ready.resolve()
    return Effect.void
  })
  yield* llm.push(raw({ head: input.head, tail: input.tail, wait: ready.promise }))
  const chat = yield* session.create({})
  const parent = yield* user(chat.id, "What is the weather?")
  const first = yield* turn({ sessionID: chat.id, parent, dir: path.resolve(input.dir) })
  yield* off
  const parts = yield* MessageV2.parts(first.msg.id)
  const next = input.follow ? yield* user(chat.id, input.follow) : parent
  yield* turn({ sessionID: chat.id, parent: next, dir: path.resolve(input.dir) })
  const inputs = yield* llm.inputs
  return { first, parts, body: inputs.at(-1) }
})

it.live("persists a signature that arrives after the tool call for the next request", () =>
  provideTmpdirServer(
    ({ dir }) =>
      Effect.gen(function* () {
        const out = yield* replay({
          dir,
          head: [
            chunk({ role: "assistant", reasoning_details: [text] }),
            chunk({
              tool_calls: [
                { index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: '{"query":"a"}' } },
              ],
            }),
            chunk({
              tool_calls: [
                { index: 1, id: "call_2", type: "function", function: { name: "lookup", arguments: '{"query":"b"}' } },
              ],
            }),
          ],
          // The signature arrives only after both tool-call events were persisted.
          tail: [chunk({ reasoning_details: [encrypted] }), chunk({}, "tool_calls")],
          gate: (part) => part.type === "tool" && part.callID === "call_2" && part.state.status !== "pending",
        })

        expect(out.first.result).toBe("continue")
        const calls = out.parts.filter((part): part is SessionV1.ToolPart => part.type === "tool")
        expect(calls.map((part) => [part.callID, part.state.status])).toEqual([
          ["call_1", "completed"],
          ["call_2", "completed"],
        ])
        expect(calls[0].metadata?.openrouter?.reasoning_details).toStrictEqual([text, encrypted])
        expect(calls[1].metadata?.openrouter).toBeUndefined()
        const session = yield* Session.Service
        const stored = yield* session.getPart({
          partID: calls[0].id,
          messageID: calls[0].messageID,
          sessionID: calls[0].sessionID,
        })
        expect(stored?.type === "tool" && stored.state.status === "completed" && stored.state.metadata).toEqual({
          source: "test",
          filediff: { file: "a.ts", before: "old", after: "new" },
        })

        const replayed = wire(out.body, "assistant")
        expect(replayed).toHaveLength(1)
        expect(replayed[0].tool_calls).toHaveLength(2)
        // The unsigned Gemini text detail is dropped by the provider converter; the signature survives.
        expect(replayed[0].reasoning_details).toStrictEqual([encrypted])
        const results = wire(out.body, "tool")
        expect(results).toHaveLength(2)
      }),
    { config },
  ),
)

it.live("persists a signature that arrives after visible reasoning ended", () =>
  provideTmpdirServer(
    ({ dir }) =>
      Effect.gen(function* () {
        const out = yield* replay({
          dir,
          head: [chunk({ role: "assistant", reasoning_details: [text] }), chunk({ content: "Sunny." })],
          tail: [chunk({ reasoning_details: [encrypted] }), chunk({}, "stop")],
          gate: (part) => part.type === "reasoning" && part.time.end !== undefined,
          follow: "Thanks",
        })

        const reasoning = out.parts.filter((part) => part.type === "reasoning")
        expect(reasoning).toHaveLength(1)
        expect(reasoning[0]).toMatchObject({
          text: text.text,
          metadata: { openrouter: { reasoning_details: [text, encrypted] } },
        })
        expect(wire(out.body, "assistant").map((message) => message.reasoning_details)).toStrictEqual([[encrypted]])
      }),
    { config },
  ),
)

it.live("persists encrypted-only reasoning that never opened a reasoning part", () =>
  provideTmpdirServer(
    ({ dir }) =>
      Effect.gen(function* () {
        const out = yield* replay({
          dir,
          head: [chunk({ role: "assistant", content: "Sunny." })],
          tail: [chunk({ reasoning_details: [encrypted] }), chunk({}, "stop")],
          gate: (part) => part.type === "text",
          follow: "Thanks",
        })

        const reasoning = out.parts.filter((part) => part.type === "reasoning")
        expect(reasoning).toHaveLength(1)
        expect(reasoning[0]).toMatchObject({ text: "", metadata: { openrouter: { reasoning_details: [encrypted] } } })
        expect(wire(out.body, "assistant").map((message) => message.reasoning_details)).toStrictEqual([[encrypted]])
      }),
    { config },
  ),
)
