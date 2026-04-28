// Verifies KiloCostPropagation.propagate() serializes concurrent writes to
// the same parent assistant message. Without the internal lock, parallel
// subagent completions race on read-modify-write and lose deltas (#6321).

import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { KiloCostPropagation } from "../../src/kilocode/session/cost-propagation"
import { Instance } from "../../src/project/instance"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID } from "../../src/session/schema"
import { Log } from "../../src/util"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const it = testEffect(Layer.mergeAll(Session.defaultLayer, Bus.layer, CrossSpawnSpawner.defaultLayer))

const seed = Effect.fn("CostPropagationTest.seed")(function* () {
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title: "parent" })
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* sessions.updateMessage(assistant)
  return { chat, assistant }
})

describe("KiloCostPropagation.propagate", () => {
  it.live("sums deltas correctly under parallel execution", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const deltas = [0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28]
        yield* Effect.all(
          deltas.map((d) => KiloCostPropagation.propagate(sessions, chat.id, assistant.id, d)),
          { concurrency: "unbounded" },
        )
        const parent = yield* Effect.sync(() => MessageV2.get({ sessionID: chat.id, messageID: assistant.id }))
        expect(parent.info.role).toBe("assistant")
        if (parent.info.role !== "assistant") return
        const total = deltas.reduce((a, b) => a + b, 0)
        expect(parent.info.cost).toBeCloseTo(total, 6)
      }),
    ),
  )

  it.live("is a no-op when amount is non-positive", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        yield* KiloCostPropagation.propagate(sessions, chat.id, assistant.id, 0)
        yield* KiloCostPropagation.propagate(sessions, chat.id, assistant.id, -1.5)
        const parent = yield* Effect.sync(() => MessageV2.get({ sessionID: chat.id, messageID: assistant.id }))
        if (parent.info.role !== "assistant") return
        expect(parent.info.cost).toBe(0)
      }),
    ),
  )
})
