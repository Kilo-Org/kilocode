// Verifies `kilo stats` does not double-count subagent cost while still
// including child-session messages, tokens, tools, and model usage. The task
// tool propagates each child session's total cost up to the parent's
// tool-wrapper assistant message (#6321).

import { afterEach, describe, expect, test } from "bun:test"
import { aggregateSessionStats } from "../../src/cli/cmd/stats"
import { MessageV2 } from "../../src/session/message-v2"
import { Instance } from "../../src/project/instance"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageID, PartID } from "../../src/session/schema"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

function assistant(sessionID: string, parentID: string, cost: number): MessageV2.Assistant {
  return {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: parentID as any,
    sessionID: sessionID as any,
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

async function step(sessionID: string, messageID: string, cost: number) {
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: messageID as any,
    sessionID: sessionID as any,
    type: "step-finish",
    reason: "stop",
    cost,
    tokens: { total: 15, input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
  })
}

async function tool(sessionID: string, messageID: string) {
  const time = Date.now()
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: messageID as any,
    sessionID: sessionID as any,
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
}

describe("stats subagent cost", () => {
  test("counts child usage without double-counting propagated cost", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ title: "root" })
        const child = await Session.create({ parentID: parent.id, title: "subagent" })

        const userMsg = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: parent.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        } as any)
        const parentMsg = await Session.updateMessage(assistant(parent.id, userMsg.id, 1.5))
        await step(parent.id, parentMsg.id, 1)

        const childUser = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: child.id,
          agent: "general",
          model: ref,
          time: { created: Date.now() },
        } as any)
        const childMsg = await Session.updateMessage(assistant(child.id, childUser.id, 0.5))
        await step(child.id, childMsg.id, 0.5)
        await tool(child.id, childMsg.id)

        const stats = await aggregateSessionStats()
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
      },
    })
  })
})
