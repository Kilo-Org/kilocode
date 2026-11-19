import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { MessageID, PartID } from "@/session/schema"
import { KiloSessionMessageOrder } from "@/kilocode/session/message-order"
import { KiloSessionPrompt } from "@/kilocode/session/prompt"
import { ProviderTest } from "../fake/provider"
import { seedProject, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Session.node, SessionProjector.node, Database.node, EventV2Bridge.node])),
)
const model = ProviderTest.model()

// Regression for #15165: a stopped compaction left its summary unfinished, so the
// compaction task stayed pending and ran again on every later prompt.
describe("interrupted compaction", () => {
  it.instance(
    "settles the unfinished summary so the compaction task is no longer pending",
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const test = yield* TestInstance
      const session = yield* sessions.create({})
      const user = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        agent: "code",
        model: { providerID: model.providerID, modelID: model.id },
        time: { created: Date.now() },
      })
      yield* sessions.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user.id,
        type: "compaction",
        auto: false,
      })
      yield* sessions.updateMessage({
        id: MessageID.ascending(),
        sessionID: session.id,
        parentID: user.id,
        role: "assistant",
        agent: "compaction",
        mode: "compaction",
        summary: true,
        modelID: model.id,
        providerID: model.providerID,
        path: { cwd: test.directory, root: test.directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now() },
      })
      expect(KiloSessionMessageOrder.latest(yield* sessions.messages({ sessionID: session.id })).tasks).toHaveLength(1)

      yield* KiloSessionPrompt.settleCompaction({ sessions, sessionID: session.id, parentID: user.id })

      const msgs = yield* sessions.messages({ sessionID: session.id })
      const summary = msgs.find((msg) => msg.info.role === "assistant")?.info
      expect(summary).toMatchObject({ finish: "error", error: { name: "MessageAbortedError" } })
      expect(KiloSessionMessageOrder.latest(msgs).tasks).toHaveLength(0)
    }),
  )
})
