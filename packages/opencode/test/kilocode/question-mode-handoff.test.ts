import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Question } from "../../src/question"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session/session"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SyncEvent } from "../../src/sync"
import { QuestionTool } from "../../src/tool/question"
import { Truncate } from "../../src/tool/truncate"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    Question.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    Session.defaultLayer,
    SyncEvent.defaultLayer,
  ),
)

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const pending = Effect.fn("QuestionModeHandoff.pending")(function* (question: Question.Interface) {
  for (let i = 0; i < 50; i++) {
    const items = yield* question.list()
    const item = items[0]
    if (item) return item
    yield* Effect.sleep("10 millis")
  }
  return yield* Effect.fail(new Error("timed out waiting for pending question request"))
})

const ctx = {
  sessionID: SessionID.make("ses_question_mode_tool"),
  messageID: MessageID.make("msg_question_mode_tool"),
  callID: "call_question_mode_tool",
  agent: "reviewer",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("question mode handoff", () => {
  it.instance("records selected option mode in question tool metadata", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const questions = [
        {
          question: "Apply review fixes?",
          header: "Review Fixes",
          options: [
            { label: "Fix all", description: "Apply all suggested fixes", mode: "code" },
            { label: "Explain", description: "Explain the findings" },
          ],
          multiple: false,
        },
      ]

      const fiber = yield* tool.execute({ questions }, ctx).pipe(Effect.forkScoped)
      const item = yield* pending(question)
      yield* question.reply({ requestID: item.id, answers: [["Fix all"]] })

      const result = yield* Fiber.join(fiber)
      expect(result.metadata.answers).toEqual([["Fix all"]])
      expect(result.metadata.mode).toBe("code")
    }),
  )

  it.instance("applies selected question mode to the parent user message", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const agents = yield* Agent.Service
      const sync = yield* SyncEvent.Service
      const chat = yield* sessions.create({ title: "Question mode handoff" })
      const user = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: chat.id,
        agent: "reviewer",
        model: ref,
        time: { created: Date.now() },
        tools: {},
      } satisfies MessageV2.User)
      const msg = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: user.id,
        sessionID: chat.id,
        mode: "reviewer",
        agent: "reviewer",
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ref.modelID,
        providerID: ref.providerID,
        time: { created: Date.now(), completed: Date.now() },
        finish: "tool-calls",
      } satisfies MessageV2.Assistant)
      const now = Date.now()
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: chat.id,
        type: "tool",
        callID: "call_question_mode_handoff",
        tool: "question",
        state: {
          status: "completed",
          input: {},
          output: "answered",
          title: "Asked 1 question",
          metadata: { answers: [["Fix all"]], mode: "code" },
          time: { start: now, end: now },
        },
      } satisfies MessageV2.ToolPart)

      yield* KiloSessionPrompt.applyQuestionMode({ messageID: msg.id, lastUser: user, sessions, agents, sync })

      const session = yield* sessions.get(chat.id)
      expect(session.agent).toBe("code")
      const msgs = yield* sessions.messages({ sessionID: chat.id })
      const stored = msgs.find((item) => item.info.id === user.id)
      expect(stored?.info.role).toBe("user")
      if (stored?.info.role === "user") expect(stored.info.agent).toBe("code")
    }),
  )
})
