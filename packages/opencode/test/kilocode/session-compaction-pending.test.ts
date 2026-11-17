import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { KiloSessionCompaction } from "@/kilocode/session/compaction"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"
import type { MessageV2 } from "@/session/message-v2"
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

  it.instance(
    "an auto request upgrades a pending manual marker instead of dropping the overflow metadata",
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const compaction = yield* SessionCompaction.Service
      const session = yield* sessions.create({})
      const input = { sessionID: session.id, agent: "code", model: ref }

      yield* compaction.create({ ...input, auto: false })
      yield* compaction.create({ ...input, auto: true, overflow: true })

      const found = yield* markers(sessions, session.id)
      expect(found).toHaveLength(1)
      const part = found[0].parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
      expect(part?.auto).toBe(true)
      expect(part?.overflow).toBe(true)

      // a later manual request must not downgrade the marker
      yield* compaction.create({ ...input, auto: false })
      const again = (yield* markers(sessions, session.id))[0].parts.find(
        (item): item is MessageV2.CompactionPart => item.type === "compaction",
      )
      expect(again?.auto).toBe(true)
      expect(again?.overflow).toBe(true)
    }),
  )

  const part = (found: MessageV2.WithParts[]) =>
    found[0].parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")

  for (const [name, first, second, overflow] of [
    ["overflow marker", true, false, false],
    ["overflow marker, undefined", true, undefined, undefined],
    ["preflight marker", false, true, true],
  ] as const) {
    it.instance(
      `an auto request replaces overflow instead of merging: ${name}`,
      Effect.gen(function* () {
        yield* seedProject
        const sessions = yield* Session.Service
        const compaction = yield* SessionCompaction.Service
        const session = yield* sessions.create({})
        const input = { sessionID: session.id, agent: "code", model: ref, auto: true }

        yield* compaction.create({ ...input, overflow: first })
        yield* compaction.create({ ...input, overflow: second })

        const found = yield* markers(sessions, session.id)
        expect(found).toHaveLength(1)
        expect(part(found)?.auto).toBe(true)
        expect(part(found)?.overflow).toBe(overflow)
      }),
    )
  }

  for (const [name, next] of [
    ["agent", { agent: "plan", model: ref }],
    ["model", { agent: "code", model: { providerID: ref.providerID, modelID: ModelV2.ID.make("other-model") } }],
  ] as const) {
    it.instance(
      `an auto request moves a manual marker to its own ${name}`,
      Effect.gen(function* () {
        yield* seedProject
        const sessions = yield* Session.Service
        const compaction = yield* SessionCompaction.Service
        const session = yield* sessions.create({})

        yield* compaction.create({ sessionID: session.id, agent: "code", model: ref, auto: false })
        yield* compaction.create({ sessionID: session.id, ...next, auto: true, overflow: false })

        const found = yield* markers(sessions, session.id)
        expect(found).toHaveLength(1)
        const info = found[0].info
        if (info.role !== "user") throw new Error("marker must be a user message")
        expect(info.agent).toBe(next.agent)
        expect(info.model).toEqual(next.model)
        expect(part(found)?.auto).toBe(true)
      }),
    )
  }

  it.instance(
    "a manual request leaves an auto marker unchanged",
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const compaction = yield* SessionCompaction.Service
      const session = yield* sessions.create({})

      yield* compaction.create({ sessionID: session.id, agent: "code", model: ref, auto: true, overflow: true })
      const before = yield* markers(sessions, session.id)
      yield* compaction.create({
        sessionID: session.id,
        agent: "plan",
        model: { providerID: ref.providerID, modelID: ModelV2.ID.make("other-model") },
        auto: false,
      })

      expect(yield* markers(sessions, session.id)).toEqual(before)
    }),
  )

  it.instance(
    "a reused marker stays visible to a follow-up turn that did not create it",
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const compaction = yield* SessionCompaction.Service
      const session = yield* sessions.create({})
      const input = { sessionID: session.id, agent: "code", model: ref }
      const user = () =>
        sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          model: ref,
          sessionID: session.id,
          agent: "code",
          time: { created: Date.now() },
        })
      const first = yield* user()
      const followup = yield* user()
      const skip = Effect.void

      // the marker is written while the first turn runs, before the follow-up's slot starts
      yield* KiloSessionPromptQueue.enqueue(session.id, first.id, compaction.create({ ...input, auto: false }), skip)
      const marker = (yield* markers(sessions, session.id))[0].info.id

      // handoff: the follow-up's slot starts with no extras, so scope() hides the older marker
      const visible = yield* KiloSessionPromptQueue.enqueue(
        session.id,
        followup.id,
        Effect.gen(function* () {
          yield* compaction.create({ ...input, auto: true, overflow: true })
          return KiloSessionPromptQueue.scope(session.id, yield* sessions.messages({ sessionID: session.id })).map(
            (msg) => msg.info.id,
          )
        }),
        Effect.succeed([]),
      )

      expect(yield* markers(sessions, session.id)).toHaveLength(1)
      expect(visible).toContain(marker)
    }),
  )
})
