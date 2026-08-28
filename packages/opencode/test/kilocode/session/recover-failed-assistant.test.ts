import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { MessageV2 } from "@/session/message-v2"
import { KiloSessionPrompt } from "@/kilocode/session/prompt"
import { MessageID, PartID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { testEffect } from "../../lib/effect"

const env = LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, SessionStatus.node]))
const it = testEffect(env)

const providerID = ProviderV2.ID.make("test")

/**
 * Builds a session whose tail is an assistant message carrying [error], plus whatever [parts] the turn
 * managed to emit before failing. Returns the ids so a test can assert what survived.
 */
const seed = Effect.fnUntraced(function* (input: {
  error?: NonNullable<MessageV2.Assistant["error"]>
  parts?: ("step-start" | "step-finish" | "text" | "tool")[]
  finish?: MessageV2.Assistant["finish"]
  orphan?: boolean
}) {
  const sessions = yield* Session.Service
  const session = yield* sessions.create({})

  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "user",
    agent: "default",
    model: { providerID, modelID: ModelV2.ID.make("test") },
    time: { created: Date.now() },
  })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: user.id,
    sessionID: session.id,
    type: "text",
    text: "do the thing",
  })

  const assistant = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    // An orphan tail points at nothing, so the seam must leave it alone.
    parentID: input.orphan ? MessageID.ascending() : user.id,
    sessionID: session.id,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelV2.ID.make("test"),
    providerID,
    time: { created: Date.now(), completed: Date.now() },
    ...(input.error ? { error: input.error } : {}),
    ...(input.finish ? { finish: input.finish } : {}),
  })

  for (const type of input.parts ?? []) {
    const base = { id: PartID.ascending(), messageID: assistant.id, sessionID: session.id }
    if (type === "step-start") yield* sessions.updatePart({ ...base, type: "step-start" })
    if (type === "step-finish")
      yield* sessions.updatePart({
        ...base,
        type: "step-finish",
        reason: "error",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })
    if (type === "text") yield* sessions.updatePart({ ...base, type: "text", text: "partial answer" })
    if (type === "tool")
      yield* sessions.updatePart({
        ...base,
        type: "tool",
        tool: "edit",
        callID: "call_1",
        state: {
          status: "completed",
          input: {},
          output: "ok",
          title: "edit",
          metadata: {},
          time: { start: 0, end: 1 },
        },
      })
  }

  return { sessionID: session.id, userID: user.id, assistantID: assistant.id }
})

const run = Effect.fnUntraced(function* (sessionID: Session.Info["id"]) {
  const sessions = yield* Session.Service
  const status = yield* SessionStatus.Service
  yield* KiloSessionPrompt.recoverFailedAssistant({ sessionID, status, sessions })
  const msgs = yield* sessions.messages({ sessionID })
  return msgs.map((m) => m.info.id)
})

const apiError = new MessageV2.APIError({ message: "provider overloaded", isRetryable: true }).toObject()

describe("KiloSessionPrompt.recoverFailedAssistant", () => {
  it.instance("removes an errored tail that only emitted turn scaffolding", () =>
    Effect.gen(function* () {
      const seeded = yield* seed({ error: apiError, parts: ["step-start", "step-finish"] })

      const remaining = yield* run(seeded.sessionID)

      expect(remaining).toEqual([seeded.userID])
    }),
  )

  it.instance("removes an errored tail with no parts at all", () =>
    Effect.gen(function* () {
      const seeded = yield* seed({ error: apiError })

      const remaining = yield* run(seeded.sessionID)

      expect(remaining).toEqual([seeded.userID])
    }),
  )

  it.instance("keeps an errored tail that emitted text", () =>
    Effect.gen(function* () {
      const seeded = yield* seed({ error: apiError, parts: ["step-start", "text"] })

      const remaining = yield* run(seeded.sessionID)

      expect(remaining).toEqual([seeded.userID, seeded.assistantID])
    }),
  )

  it.instance("keeps an errored tail that ran a tool, whose edits may still be on disk", () =>
    Effect.gen(function* () {
      const seeded = yield* seed({ error: apiError, parts: ["step-start", "tool"] })

      const remaining = yield* run(seeded.sessionID)

      expect(remaining).toEqual([seeded.userID, seeded.assistantID])
    }),
  )

  it.instance("keeps a user-aborted tail, which is a stop rather than a failure", () =>
    Effect.gen(function* () {
      const aborted = new MessageV2.AbortedError({ message: "aborted" }).toObject()
      const seeded = yield* seed({ error: aborted, parts: ["step-start"] })

      const remaining = yield* run(seeded.sessionID)

      expect(remaining).toEqual([seeded.userID, seeded.assistantID])
    }),
  )

  it.instance("leaves a tail with no error to the other recover seams", () =>
    Effect.gen(function* () {
      const seeded = yield* seed({ finish: "error", parts: ["step-start", "step-finish"] })

      const remaining = yield* run(seeded.sessionID)

      expect(remaining).toEqual([seeded.userID, seeded.assistantID])
    }),
  )

  it.instance("keeps an errored tail whose parent is not the preceding user message", () =>
    Effect.gen(function* () {
      const seeded = yield* seed({ error: apiError, parts: ["step-start"], orphan: true })

      const remaining = yield* run(seeded.sessionID)

      expect(remaining).toEqual([seeded.userID, seeded.assistantID])
    }),
  )

  it.instance("keeps an errored tail while the session is still working", () =>
    Effect.gen(function* () {
      const seeded = yield* seed({ error: apiError, parts: ["step-start"] })
      const status = yield* SessionStatus.Service
      yield* status.set(seeded.sessionID, { type: "busy" })

      const remaining = yield* run(seeded.sessionID)

      expect(remaining).toEqual([seeded.userID, seeded.assistantID])
    }),
  )
})
