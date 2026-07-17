// Verifies `kilo stats` does not double-count subagent cost while still
// including child-session messages, tokens, tools, and model usage. The task
// tool propagates each child session's total cost up to the parent's
// tool-wrapper assistant message (#6321).

import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { aggregateSessionStats } from "../../src/cli/cmd/stats"
import { MessageV2 } from "../../src/session/message-v2"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Session } from "../../src/session/session"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const it = testEffect(Layer.mergeAll(Session.defaultLayer, Database.defaultLayer))

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

function assistant(sessionID: SessionID, parentID: MessageID, cost: number): MessageV2.Assistant {
  return {
    id: MessageID.ascending(),
    role: "assistant",
    parentID,
    sessionID,
    mode: "build",
    agent: "build",
    cost,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
}

const step = Effect.fn("StatsSubagentCost.step")(function* (sessionID: SessionID, messageID: MessageID, cost: number) {
  const svc = yield* Session.Service
  yield* svc.updatePart({
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "step-finish",
    reason: "stop",
    cost,
    tokens: { total: 15, input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
  })
})

const tool = Effect.fn("StatsSubagentCost.tool")(function* (sessionID: SessionID, messageID: MessageID) {
  const time = Date.now()
  const svc = yield* Session.Service
  yield* svc.updatePart({
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "tool",
    callID: "call_1",
    tool: "bash",
    state: {
      status: "completed",
      input: {},
      output: "ok",
      title: "bash",
      metadata: {},
      time: { start: time, end: time },
    },
  })
})

describe("stats subagent cost", () => {
  it.instance(
    "counts child usage without double-counting propagated cost",
    () =>
      Effect.gen(function* () {
        const svc = yield* Session.Service
        const parent = yield* svc.create({ title: "root" })
        const child = yield* svc.create({ parentID: parent.id, title: "subagent" })

        const userMsg = yield* svc.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: parent.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        const parentMsg = yield* svc.updateMessage(assistant(parent.id, userMsg.id, 1.5))
        yield* step(parent.id, parentMsg.id, 1)

        const childUser = yield* svc.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: child.id,
          agent: "general",
          model: ref,
          time: { created: Date.now() },
        })
        const childMsg = yield* svc.updateMessage(assistant(child.id, childUser.id, 0.5))
        yield* step(child.id, childMsg.id, 0.5)
        yield* tool(child.id, childMsg.id)

        const stats = yield* aggregateSessionStats()
        const model = stats.modelUsage["test/test-model"]!
        expect(stats.totalCost).toBeCloseTo(1.5, 6)
        expect(stats.totalSessions).toBe(2)
        expect(stats.totalMessages).toBe(4)
        expect(stats.totalTokens.input).toBe(20)
        expect(stats.totalTokens.output).toBe(10)
        expect(stats.toolUsage.bash).toBe(1)
        expect(model.messages).toBe(2)
        expect(model.tokens.input).toBe(20)
        expect(model.tokens.output).toBe(10)
        expect(model.cost).toBeCloseTo(1.5, 6)
      }),
    { git: true },
  )
})
