import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { MessageV2 } from "@/session/message-v2"
import { SessionRevert } from "@/session/revert"
import { MessageID, PartID } from "@/session/schema"
import { Session } from "@/session/session"
import { Snapshot } from "@/snapshot"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const env = Layer.mergeAll(
  Session.defaultLayer,
  SessionRevert.defaultLayer,
  Snapshot.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env)

describe("partial assistant revert", () => {
  it.live(
    "clears provider errors when the revert becomes permanent",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const session = yield* sessions.create({})
          const providerID = ProviderV2.ID.make("test")
          const user = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "user",
            agent: "default",
            model: { providerID, modelID: ModelV2.ID.make("test") },
            time: { created: Date.now() },
          })
          const assistant = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "assistant",
            parentID: user.id,
            mode: "default",
            agent: "default",
            path: { cwd: dir, root: dir },
            cost: 1,
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ModelV2.ID.make("test"),
            providerID,
            time: { created: Date.now(), completed: Date.now() },
            finish: "error",
            error: MessageV2.fromError(new Error("Provider returned error"), { providerID }),
          })
          const kept = yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: assistant.id,
            sessionID: session.id,
            type: "text",
            text: "keep",
          })
          const boundary = yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: assistant.id,
            sessionID: session.id,
            type: "text",
            text: "remove",
          })

          yield* sessions.setRevert({
            sessionID: session.id,
            revert: { messageID: assistant.id, partID: boundary.id },
            summary: { additions: 0, deletions: 0, files: 0 },
          })
          yield* revert.cleanup(yield* sessions.get(session.id))

          const messages = yield* sessions.messages({ sessionID: session.id })
          const result = messages.find((message) => message.info.id === assistant.id)
          expect(result?.parts.map((part) => part.id)).toEqual([kept.id])
          expect(result?.info).not.toHaveProperty("error")
        }),
      { git: true },
    ),
  )
})
