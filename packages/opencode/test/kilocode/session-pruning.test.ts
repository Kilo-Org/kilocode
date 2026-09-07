import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { ProviderTest } from "../fake/provider"
import { seedProject, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([SessionCompaction.node, Session.node, SessionProjector.node, Database.node, EventV2Bridge.node]),
  ),
)
const model = ProviderTest.model()
const config = { compaction: { prune: true } }

const user = Effect.fnUntraced(function* (sessionID: SessionID) {
  const sessions = yield* Session.Service
  const message = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    agent: "general",
    model: { providerID: model.providerID, modelID: model.id },
    time: { created: Date.now() },
  })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: message.id,
    type: "text",
    text: "Complete the task",
  })
  return message
})

const setup = Effect.gen(function* () {
  yield* seedProject
  const sessions = yield* Session.Service
  const root = yield* sessions.create({})
  const child = yield* sessions.create({ parentID: root.id })
  return yield* user(child.id)
})

const assistant = Effect.fnUntraced(function* (
  parent: MessageV2.User,
  opts: Partial<Pick<MessageV2.Assistant, "time" | "finish" | "summary" | "error">> = {},
) {
  const sessions = yield* Session.Service
  const test = yield* TestInstance
  const time = Date.now()
  return yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID: parent.sessionID,
    parentID: parent.id,
    role: "assistant",
    agent: "general",
    mode: "general",
    modelID: model.id,
    providerID: model.providerID,
    path: { cwd: test.directory, root: test.directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: time, completed: time },
    finish: "tool-calls",
    ...opts,
  })
})

const step = Effect.fnUntraced(function* (
  parent: MessageV2.User,
  output: string,
  opts: { tool?: string; completed?: boolean; compacted?: number } = {},
) {
  const sessions = yield* Session.Service
  const time = Date.now()
  const message = yield* assistant(
    parent,
    opts.completed === false ? { time: { created: time }, finish: undefined } : {},
  )
  return yield* sessions.updatePart({
    id: PartID.ascending(),
    sessionID: parent.sessionID,
    messageID: message.id,
    type: "tool",
    tool: opts.tool ?? "bash",
    callID: crypto.randomUUID(),
    state: {
      status: "completed",
      input: { command: "pwd" },
      output,
      title: "result",
      metadata: {},
      time: { start: time, end: time, compacted: opts.compacted },
    },
  })
})

const summary = Effect.fnUntraced(function* (parent: MessageV2.User) {
  const sessions = yield* Session.Service
  const message = yield* assistant(parent, { summary: true, finish: "stop" })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    sessionID: parent.sessionID,
    messageID: message.id,
    type: "text",
    text: "Summary of completed work",
  })
})

const tools = Effect.fnUntraced(function* (sessionID: SessionID) {
  const sessions = yield* Session.Service
  const messages = yield* sessions.messages({ sessionID })
  return messages.flatMap((message) => message.parts).filter((part) => part.type === "tool")
})

const marked = (parts: MessageV2.ToolPart[]) =>
  parts.map((part) => part.state.status === "completed" && !!part.state.time.compacted)

const outputs = Array.from({ length: 6 }, (_, index) => String(index).repeat(80_000))

describe("single-turn tool-output pruning", () => {
  it.instance(
    "prunes old subagent outputs while preserving two completed steps and the token budget",
    Effect.gen(function* () {
      const parent = yield* setup
      const sessions = yield* Session.Service
      const compact = yield* SessionCompaction.Service
      const parts: MessageV2.ToolPart[] = []
      for (const output of outputs) parts.push(yield* step(parent, output))

      yield* compact.prune({ sessionID: parent.sessionID })

      expect(marked(yield* tools(parent.sessionID))).toEqual([true, true, false, false, false, false])
      const messages = yield* sessions.messages({ sessionID: parent.sessionID })
      expect(messages.filter((message) => message.info.role === "user")).toHaveLength(1)
      const converted = yield* MessageV2.toModelMessagesEffect(messages, model)
      expect(converted.flatMap((message) => (message.role === "tool" ? message.content : []))).toEqual(
        parts.map((part, index) => ({
          type: "tool-result",
          toolCallId: part.callID,
          toolName: "bash",
          output: { type: "text", value: index < 2 ? "[Old tool result content cleared]" : (outputs.at(index) ?? "") },
        })),
      )
    }),
    { config },
  )

  it.instance(
    "does not count an in-flight assistant as a completed step",
    Effect.gen(function* () {
      const parent = yield* setup
      const compact = yield* SessionCompaction.Service
      yield* step(parent, "x".repeat(200_000))
      yield* step(parent, "recent")
      yield* assistant(parent, { time: { created: Date.now() } })

      yield* compact.prune({ sessionID: parent.sessionID, reason: "payload-limit" })

      expect(marked(yield* tools(parent.sessionID))).toEqual([false, false])
    }),
  )

  for (const attempt of [
    { name: "failed", info: { error: new MessageV2.AbortedError({ message: "aborted" }).toObject() } },
    { name: "preflight", info: { finish: undefined } },
    { name: "provider-error", info: { finish: "error" } },
  ]) {
    it.instance(
      `does not count a ${attempt.name} assistant as a completed step`,
      Effect.gen(function* () {
        const parent = yield* setup
        const compact = yield* SessionCompaction.Service
        yield* step(parent, "x".repeat(200_000))
        yield* step(parent, "recent")
        yield* assistant(parent, attempt.info)

        yield* compact.prune({ sessionID: parent.sessionID, reason: "payload-limit" })

        expect(marked(yield* tools(parent.sessionID))).toEqual([false, false])
      }),
    )
  }

  it.instance(
    "does not prune when eligible output only reaches the minimum",
    Effect.gen(function* () {
      const parent = yield* setup
      const compact = yield* SessionCompaction.Service
      for (const output of outputs.slice(1)) yield* step(parent, output)

      yield* compact.prune({ sessionID: parent.sessionID })

      expect(marked(yield* tools(parent.sessionID))).toEqual([false, false, false, false, false])
    }),
    { config },
  )

  it.instance(
    "preserves protected skill output while pruning eligible tools",
    Effect.gen(function* () {
      const parent = yield* setup
      const compact = yield* SessionCompaction.Service
      const skill = yield* step(parent, "s".repeat(200_000), { tool: "skill" })
      yield* step(parent, "x".repeat(200_000))
      yield* step(parent, "recent one")
      yield* step(parent, "recent two")

      yield* compact.prune({ sessionID: parent.sessionID })

      const parts = yield* tools(parent.sessionID)
      expect(marked(parts)).toEqual([false, true, false, false])
      expect(parts.at(0)).toEqual(skill)
    }),
    { config },
  )

  it.instance(
    "keeps user-turn pruning for old messages without completion timestamps",
    Effect.gen(function* () {
      const parent = yield* setup
      const compact = yield* SessionCompaction.Service
      yield* step(parent, "x".repeat(200_000), { completed: false })
      const second = yield* user(parent.sessionID)
      yield* step(second, "y".repeat(200_000))
      const third = yield* user(parent.sessionID)
      yield* step(third, "z".repeat(200_000))

      yield* compact.prune({ sessionID: parent.sessionID })

      expect(marked(yield* tools(parent.sessionID))).toEqual([true, false, false])
    }),
    { config },
  )

  it.instance(
    "does not activate step-based pruning before a recent summary",
    Effect.gen(function* () {
      const parent = yield* setup
      const compact = yield* SessionCompaction.Service
      yield* step(parent, "x".repeat(200_000))
      const marker = yield* user(parent.sessionID)
      yield* summary(marker)
      yield* step(marker, "recent")

      yield* compact.prune({ sessionID: parent.sessionID, reason: "post-compaction" })

      expect(marked(yield* tools(parent.sessionID))).toEqual([false, false])
    }),
  )

  it.instance(
    "preserves user-turn cleanup across a recent compaction summary",
    Effect.gen(function* () {
      const parent = yield* setup
      const compact = yield* SessionCompaction.Service
      yield* step(parent, "x".repeat(200_000))
      const marker = yield* user(parent.sessionID)
      yield* summary(marker)
      const continuation = yield* user(parent.sessionID)
      yield* step(continuation, "recent one")
      yield* step(continuation, "recent two")

      yield* compact.prune({ sessionID: parent.sessionID, reason: "post-compaction" })

      expect(marked(yield* tools(parent.sessionID))).toEqual([true, false, false])
    }),
  )

  it.instance(
    "stops at an already compacted tool output",
    Effect.gen(function* () {
      const parent = yield* setup
      const compact = yield* SessionCompaction.Service
      yield* step(parent, "old".repeat(80_000))
      yield* step(parent, "cleared", { compacted: 1 })
      for (const output of outputs) yield* step(parent, output)

      yield* compact.prune({ sessionID: parent.sessionID })

      const parts = yield* tools(parent.sessionID)
      expect(marked(parts)).toEqual([false, true, true, true, false, false, false, false])
      expect(parts.at(1)?.state).toMatchObject({ time: { compacted: 1 } })
    }),
    { config },
  )

  for (const reason of ["normal", "payload-limit"] as const) {
    it.instance(
      reason === "normal" ? "keeps normal pruning opt-in" : "honors explicitly disabled payload pruning",
      Effect.gen(function* () {
        const parent = yield* setup
        const compact = yield* SessionCompaction.Service
        for (const output of outputs) yield* step(parent, output)

        yield* compact.prune({ sessionID: parent.sessionID, reason })

        expect(marked(yield* tools(parent.sessionID))).toEqual([false, false, false, false, false, false])
      }),
      { config: { compaction: { prune: reason === "normal" ? undefined : false } } },
    )
  }
})
