import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { KiloSessionCompaction } from "@/kilocode/session/compaction"
import { ProviderTest } from "../fake/provider"
import { seedProject, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([SessionCompaction.node, Session.node, SessionProjector.node, Database.node, EventV2Bridge.node]),
  ),
)
const model = ProviderTest.model()
const ref = { providerID: model.providerID, modelID: model.id }

const markers = (sessions: Session.Interface, sessionID: SessionID) =>
  sessions
    .messages({ sessionID })
    .pipe(Effect.map((msgs) => msgs.filter((msg) => msg.parts.some((part) => part.type === "compaction"))))

// Regression for #15266: every /compact wrote another marker while one was still queued behind a
// running turn, so later markers summarized the previous summary.
describe("pending compaction marker", () => {
  it.instance(
    "a second create is a no-op while the first marker has no summary",
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const compaction = yield* SessionCompaction.Service
      const session = yield* sessions.create({})
      const input = { sessionID: session.id, agent: "code", model: ref, auto: false }

      yield* compaction.create(input)
      yield* compaction.create(input)
      yield* compaction.create({ ...input, auto: true })

      expect(yield* markers(sessions, session.id)).toHaveLength(1)
    }),
  )

  it.instance(
    "concurrent creates write one marker",
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const compaction = yield* SessionCompaction.Service
      const session = yield* sessions.create({})
      const input = { sessionID: session.id, agent: "code", model: ref, auto: false }

      yield* Effect.all([compaction.create(input), compaction.create(input), compaction.create(input)], {
        concurrency: "unbounded",
      })

      expect(yield* markers(sessions, session.id)).toHaveLength(1)
    }),
  )

  it.instance(
    "a new marker is allowed once the previous one has started its summary",
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const compaction = yield* SessionCompaction.Service
      const test = yield* TestInstance
      const session = yield* sessions.create({})
      const input = { sessionID: session.id, agent: "code", model: ref, auto: false }

      yield* compaction.create(input)
      const first = (yield* markers(sessions, session.id))[0].info.id
      expect(KiloSessionCompaction.pending(yield* sessions.messages({ sessionID: session.id }))?.info.id).toBe(first)

      yield* sessions.updateMessage({
        id: MessageID.ascending(),
        sessionID: session.id,
        parentID: first,
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
      expect(KiloSessionCompaction.pending(yield* sessions.messages({ sessionID: session.id }))).toBeUndefined()

      yield* compaction.create(input)
      expect(yield* markers(sessions, session.id)).toHaveLength(2)
    }),
  )
})
