import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ModelUsage } from "@/kilocode/session/model-usage"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Session.defaultLayer, Database.defaultLayer))

const ref = (providerID: string, modelID: string) => ({
  providerID: ProviderV2.ID.make(providerID),
  modelID: ModelV2.ID.make(modelID),
})

const seed = Effect.fn("ModelUsageTest.seed")(function* (sessionID: SessionID, model: ReturnType<typeof ref>) {
  const sessions = yield* Session.Service
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model,
    time: { created: Date.now() },
  })
  return yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID,
    mode: "build",
    agent: "build",
    cost: 99,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: model.modelID,
    providerID: model.providerID,
    time: { created: Date.now() },
  } satisfies MessageV2.Assistant)
})

const step = Effect.fn("ModelUsageTest.step")(function* (input: {
  sessionID: SessionID
  messageID: MessageID
  model?: ReturnType<typeof ref>
  cost: number
  tokens: MessageV2.StepFinishPart["tokens"]
}) {
  const sessions = yield* Session.Service
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: input.messageID,
    sessionID: input.sessionID,
    type: "step-finish",
    reason: "stop",
    model: input.model,
    cost: input.cost,
    tokens: input.tokens,
  })
})

describe("session model usage", () => {
  it.instance("aggregates direct step usage by model across the top-level session tree", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const test = yield* TestInstance
      const root = yield* sessions.create({ title: "root" })
      const child = yield* sessions.create({ title: "child", parentID: root.id })
      const sibling = yield* sessions.create({ title: "sibling", parentID: root.id })
      const unrelated = yield* sessions.create({ title: "unrelated" })
      const auto = ref("kilo", "kilo-auto/efficient")
      const routed = ref("kilo", "openai/gpt-5")
      const direct = ref("google", "gemini-pro")

      const rootMessage = yield* seed(root.id, auto)
      yield* step({
        sessionID: root.id,
        messageID: rootMessage.id,
        model: routed,
        cost: 0.25,
        tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 200, write: 10 } },
      })

      const childMessage = yield* seed(child.id, direct)
      yield* step({
        sessionID: child.id,
        messageID: childMessage.id,
        cost: 0.75,
        tokens: { input: 200, output: 40, reasoning: 15, cache: { read: 400, write: 30 } },
      })

      const siblingMessage = yield* seed(sibling.id, direct)
      yield* step({
        sessionID: sibling.id,
        messageID: siblingMessage.id,
        cost: 0.125,
        tokens: { input: 50, output: 10, reasoning: 0, cache: { read: 100, write: 5 } },
      })

      const unrelatedMessage = yield* seed(unrelated.id, ref("test", "excluded"))
      yield* step({
        sessionID: unrelated.id,
        messageID: unrelatedMessage.id,
        cost: 9,
        tokens: { input: 9_000, output: 9_000, reasoning: 9_000, cache: { read: 9_000, write: 9_000 } },
      })

      const project = ProjectV2.ID.make("legacy-project")
      const { db } = yield* Database.Service
      yield* db.insert(ProjectTable).values({
        id: project,
        worktree: AbsolutePath.make(test.directory),
        vcs: "git",
        time_created: Date.now(),
        time_updated: Date.now(),
        sandboxes: [],
      })
      yield* Effect.forEach([root, child, sibling], (session) =>
        db.update(SessionTable).set({ project_id: project }).where(eq(SessionTable.id, session.id)),
      )

      expect(yield* ModelUsage.get(child.id)).toEqual({
        sessionIDs: [root.id, sibling.id, child.id].sort(),
        totals: {
          steps: 3,
          cost: 1.125,
          tokens: { input: 350, output: 70, reasoning: 20, cache: { read: 700, write: 45 } },
        },
        models: [
          {
            ...direct,
            steps: 2,
            cost: 0.875,
            tokens: { input: 250, output: 50, reasoning: 15, cache: { read: 500, write: 35 } },
          },
          {
            ...routed,
            steps: 1,
            cost: 0.25,
            tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 200, write: 10 } },
          },
        ],
      })
    }),
  )

  it.instance("returns undefined for a missing session", () =>
    Effect.gen(function* () {
      expect(yield* ModelUsage.get(SessionID.make("ses_missing"))).toBeUndefined()
    }),
  )
})
