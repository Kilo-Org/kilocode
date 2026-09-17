import { afterEach, beforeEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { MessageID, SessionID } from "../../src/session/schema"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session/session"
import { SessionCompaction } from "../../src/session/compaction"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { CompactTool, ContextInfoTool } from "../../src/kilocode/tool/context"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

type Msg = Tool.Context["messages"][number]

type Tokens = { input: number; output: number; reasoning: number; cache: { read: number; write: number } }

const tokens = (input: number, output = 0): Tokens => ({
  input,
  output,
  reasoning: 0,
  cache: { read: 0, write: 0 },
})

const user = (model: { providerID: string; modelID: string } = { providerID: "test", modelID: "test-model" }): Msg =>
  ({ info: { role: "user", model }, parts: [] }) as unknown as Msg

const assistant = (usage: Tokens, finish?: string, created = 0): Msg =>
  ({ info: { role: "assistant", finish, tokens: usage, time: { created } }, parts: [{}] }) as unknown as Msg

// A user message carrying a compaction part that no finished summary has
// consumed yet — the loop's own definition of queued compaction work.
const compaction = (created = 3_000): Msg =>
  ({
    info: { role: "user", model: { providerID: "test", modelID: "test-model" }, time: { created } },
    parts: [{ type: "compaction" }],
  }) as unknown as Msg

let session: { model?: { id: string; providerID: string } } = {}
let lookup: Effect.Effect<{ limit: { context: number } }, unknown> = Effect.succeed({ limit: { context: 100_000 } })
const created: Array<{ sessionID: string; agent: string; model: { providerID: string; modelID: string }; auto: boolean }> =
  []

const sessionLayer = Layer.mock(Session.Service, {
  get: () => Effect.succeed(session as any),
})

const providerLayer = Layer.mock(Provider.Service, {
  getModel: () => lookup as any,
})

const compactionLayer = Layer.mock(SessionCompaction.Service, {
  create: (input: any) =>
    Effect.sync(() => {
      created.push(input)
    }),
})

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Agent.node,
      FSUtil.node,
      CrossSpawnSpawner.node,
      Truncate.node,
      Session.node,
      Provider.node,
      SessionCompaction.node,
    ]),
    [
      [Session.node, sessionLayer],
      [Provider.node, providerLayer],
      [SessionCompaction.node, compactionLayer],
    ],
  ),
)

const ctx = (messages: Msg[]): Tool.Context => ({
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages,
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

const info = Effect.fn("ContextToolsTest.info")(function* (messages: Msg[]) {
  const tool = yield* ContextInfoTool
  const def = yield* tool.init()
  return yield* def.execute({}, ctx(messages))
})

const compact = Effect.fn("ContextToolsTest.compact")(function* (messages: Msg[]) {
  const tool = yield* CompactTool
  const def = yield* tool.init()
  return yield* def.execute({}, ctx(messages))
})

beforeEach(() => {
  session = { model: { id: "test-model", providerID: "test" } }
  lookup = Effect.succeed({ limit: { context: 100_000 } })
  created.length = 0
})

afterEach(async () => {
  await disposeAllInstances()
})

describe("kilocode.tool.context", () => {
  describe("get_context_info", () => {
    it.instance("reports context information for a completed step", () =>
      Effect.gen(function* () {
        const result = yield* info([user(), assistant(tokens(1000, 20), "stop")])
        const payload = JSON.parse(result.output)

        expect(result.title).toBe("context info")
        expect(payload.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
        expect(payload.sessionID).toBe("ses_test")
        expect(payload.agent).toBe("build")
        expect(payload.model).toBe("test/test-model")
        expect(payload.messages).toBe(2)
        expect(payload.parts).toBe(1)
        expect(payload.tokens).toEqual(tokens(1000, 20))
        expect(payload.contextTokens).toBe(1020)
        expect(payload.contextLimit).toBe(100_000)
        expect(payload.contextRemaining).toBe(98_980)
      }),
    )

    it.instance("reports empty usage when no step has completed", () =>
      Effect.gen(function* () {
        const result = yield* info([user(), assistant(tokens(1000, 20))])
        const payload = JSON.parse(result.output)

        expect(payload.time).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(payload.tokens).toBeNull()
        expect(payload.contextTokens).toBe(0)
        expect(payload.contextLimit).toBe(100_000)
        expect(payload.contextRemaining).toBe(100_000)
      }),
    )

    it.instance("degrades to a null limit when the model lookup fails", () =>
      Effect.gen(function* () {
        lookup = Effect.fail(new Error("model lookup failed"))

        const result = yield* info([user(), assistant(tokens(1000, 20), "stop")])
        const payload = JSON.parse(result.output)

        expect(payload.contextLimit).toBeNull()
        expect(payload.contextRemaining).toBeNull()
        expect(payload.contextTokens).toBe(1020)
        expect(payload.tokens).toEqual(tokens(1000, 20))
      }),
    )

    it.instance("reads the last finished step by chronology, not array position", () =>
      Effect.gen(function* () {
        // filterCompacted moves the retained tail after a newer compaction turn,
        // so the last array element is not the newest message.
        const newer = assistant(tokens(100, 10), "stop", 2_000)
        const stale = assistant(tokens(900, 90), "stop", 1_000)

        const result = yield* info([newer, stale])
        const payload = JSON.parse(result.output)

        expect(payload.tokens).toEqual(tokens(100, 10))
        expect(payload.contextTokens).toBe(110)
      }),
    )

    it.instance("reports an unknown context window as null, not as exhausted", () =>
      Effect.gen(function* () {
        lookup = Effect.succeed({ limit: { context: 0 } })

        const result = yield* info([user(), assistant(tokens(1000, 20), "stop")])
        const payload = JSON.parse(result.output)

        expect(payload.contextLimit).toBeNull()
        expect(payload.contextRemaining).toBeNull()
        expect(payload.contextTokens).toBe(1020)
      }),
    )
  })

  describe("compact", () => {
    it.instance("schedules exactly one compaction with the session model", () =>
      Effect.gen(function* () {
        const result = yield* compact([])

        expect(result.title).toBe("context compaction scheduled")
        expect(created).toEqual([
          {
            sessionID: "ses_test",
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            auto: false,
          },
        ])
      }),
    )

    it.instance("falls back to the last user message model", () =>
      Effect.gen(function* () {
        session = {}
        const result = yield* compact([user()])

        expect(result.title).toBe("context compaction scheduled")
        expect(created).toEqual([
          {
            sessionID: "ses_test",
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            auto: false,
          },
        ])
      }),
    )

    it.instance("fails when the session has no model and no prior user turn", () =>
      Effect.gen(function* () {
        session = {}
        const exit = yield* compact([]).pipe(Effect.exit)

        if (Exit.isSuccess(exit)) throw new Error("expected compact to fail")
        expect(Cause.pretty(exit.cause)).toContain("Cannot compact")
      }),
    )

    it.instance("does not queue a second summariser pass while one is pending", () =>
      Effect.gen(function* () {
        const result = yield* compact([assistant(tokens(1000, 20), "stop"), compaction()])

        expect(result.title).toBe("context compaction already scheduled")
        expect(created).toEqual([])
      }),
    )

    it.instance("collapses sibling compact calls in one step into one pass", () =>
      Effect.gen(function* () {
        const tool = yield* CompactTool
        const def = yield* tool.init()
        const context = ctx([])

        yield* def.execute({}, context)
        const second = yield* def.execute({}, context)

        expect(second.title).toBe("context compaction already scheduled")
        expect(created).toHaveLength(1)
      }),
    )

    it.instance("still schedules a compaction after the previous one has finished", () =>
      Effect.gen(function* () {
        const result = yield* compact([assistant(tokens(1000, 20), "stop"), user()])

        expect(result.title).toBe("context compaction scheduled")
        expect(created).toHaveLength(1)
      }),
    )
  })
})
