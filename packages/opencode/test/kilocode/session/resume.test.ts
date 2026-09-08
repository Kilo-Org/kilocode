import path from "path"
import { expect } from "bun:test"
import { Effect, Fiber, Stream } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { MessageV2 } from "@/session/message-v2"
import { PartID } from "@/session/schema"
import { TestInstance } from "../../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../../lib/effect"
import { reply, TestLLMServer } from "../../lib/llm-server"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      SessionStatus.node,
      EventV2Bridge.node,
      FSUtil.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
  ),
)

const setup = Effect.fnUntraced(function* () {
  const llm = yield* TestLLMServer
  const fs = yield* FSUtil.Service
  const instance = yield* TestInstance
  yield* fs.writeWithDirs(
    path.join(instance.directory, "opencode.json"),
    JSON.stringify({
      model: "test/test-model",
      small_model: "test/test-model",
      enabled_providers: ["test"],
      formatter: false,
      lsp: false,
      provider: {
        test: {
          name: "Test",
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test-key", baseURL: llm.url },
          models: {
            "test-model": {
              name: "Test Model",
              tool_call: true,
              limit: { context: 100000, output: 10000 },
            },
          },
        },
      },
    }),
  )
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const status = yield* SessionStatus.Service
  const session = yield* sessions.create({ title: "Resume validation" })
  const user = yield* prompt.prompt({
    sessionID: session.id,
    agent: "code",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
    noReply: true,
    parts: [{ type: "text", text: "Complete the original task" }],
  })
  return { llm, sessions, prompt, status, session, user }
})

it.instance(
  "resumes an aborted OpenCode stream on the original user turn",
  () =>
    Effect.gen(function* () {
      const { llm, sessions, prompt, status, session, user } = yield* setup()
      const events = yield* EventV2Bridge.Service
      const received = yield* events.subscribe(MessageV2.Event.PartDelta).pipe(
        Stream.filter((event) => event.data.sessionID === session.id && event.data.delta === "Partial result"),
        Stream.take(1),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true }),
      )
      yield* llm.push(reply().text("Partial result").hang())
      const fiber = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(Fiber.join(received), "partial output never arrived", "10 seconds")
      yield* prompt.cancel(session.id)
      yield* Fiber.join(fiber)
      expect((yield* status.get(session.id)).type).toBe("idle")
      const stopped = (yield* sessions.messages({ sessionID: session.id })).at(-1)
      expect(stopped?.info.role === "assistant" && MessageV2.AbortedError.isInstance(stopped.info.error)).toBe(true)

      if (!stopped) throw new Error("Missing interrupted assistant")
      yield* llm.text("Finished the original task")
      const resumed = yield* prompt.loop({ sessionID: session.id, resume: stopped.info.id })
      expect(resumed.info.role === "assistant" && resumed.info.parentID).toBe(user.info.id)
      expect(resumed.parts.some((part) => part.type === "text" && part.text === "Finished the original task")).toBe(
        true,
      )
      const messages = yield* sessions.messages({ sessionID: session.id })
      expect(messages.filter((message) => message.info.role === "user").map((message) => message.info.id)).toEqual([
        user.info.id,
      ])
      expect(messages.some((message) => message.info.id === stopped?.info.id)).toBe(true)
      const body = (yield* llm.hits).at(-1)?.body
      expect(JSON.stringify(body)).toContain("Partial result")
      expect(Array.isArray(body?.messages) && body.messages.at(-1)).toMatchObject({
        role: "user",
        content: expect.stringContaining("[TASK RESUMPTION]"),
      })
      expect(JSON.stringify(messages)).not.toContain("[TASK RESUMPTION]")
      expect(yield* llm.hits).toHaveLength(2)
    }),
  30_000,
)

it.instance(
  "does not restart a completed OpenCode response",
  () =>
    Effect.gen(function* () {
      const { llm, prompt, session } = yield* setup()
      yield* llm.text("Done")
      const completed = yield* prompt.loop({ sessionID: session.id })
      const repeated = yield* prompt.loop({ sessionID: session.id, resume: completed.info.id })
      expect(repeated.info.id).toBe(completed.info.id)
      expect(yield* llm.hits).toHaveLength(1)
    }),
  30_000,
)

it.instance(
  "retains interrupted tool results when resuming an unfinished OpenCode turn",
  () =>
    Effect.gen(function* () {
      const { llm, sessions, prompt, session, user } = yield* setup()
      yield* llm.text("Partial result")
      const completed = yield* prompt.loop({ sessionID: session.id })
      if (completed.info.role !== "assistant") throw new Error("Expected assistant")
      yield* sessions.updateMessage({
        ...completed.info,
        finish: "stop",
        error: new MessageV2.AbortedError({ message: "Stopped" }).toObject(),
      })
      yield* sessions.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: completed.info.id,
        type: "tool",
        tool: "read",
        callID: "interrupted-read",
        state: {
          status: "error",
          input: { filePath: "/missing.txt" },
          error: "Tool execution aborted",
          metadata: { interrupted: true },
          time: { start: 1, end: 2 },
        },
      })
      yield* llm.text("Continued with the interruption recorded")
      const resumed = yield* prompt.loop({ sessionID: session.id, resume: completed.info.id })
      expect(resumed.info.role === "assistant" && resumed.info.parentID).toBe(user.info.id)
      expect(JSON.stringify((yield* llm.hits).at(-1)?.body)).toContain("Tool execution aborted")
      expect(
        (yield* sessions.messages({ sessionID: session.id })).filter((message) => message.info.role === "user"),
      ).toHaveLength(1)
      expect(yield* llm.hits).toHaveLength(2)
    }),
  30_000,
)
