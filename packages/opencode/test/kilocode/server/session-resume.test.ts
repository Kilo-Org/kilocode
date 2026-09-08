import { afterEach, expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceStore } from "@/project/instance-store"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Server } from "@/server/server"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID } from "@/session/schema"
import { Question } from "@/question"
import { Permission } from "@/permission"
import { disposeAllInstances, provideInstanceEffect, tmpdirScoped } from "../../fixture/fixture"
import { resetDatabase } from "../../fixture/db"
import { pollWithTimeout, testEffectShared } from "../../lib/effect"

const it = testEffectShared(
  AppNodeBuilderV1.build(
    LayerNode.group([
      Session.node,
      Question.node,
      Permission.node,
      InstanceStore.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)
const password = Flag.KILO_SERVER_PASSWORD

afterEach(async () => {
  Flag.KILO_SERVER_PASSWORD = password
  await disposeAllInstances()
  await resetDatabase()
})

it.live(
  "HTTP resume preserves the user turn and refuses blocked, completed, and stale requests",
  () =>
    Effect.gen(function* () {
      Flag.KILO_SERVER_PASSWORD = undefined
      const calls: unknown[] = []
      const gate = Promise.withResolvers<void>()
      const provider = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
          calls.push(await request.json())
          await gate.promise
          const events = [
            { delta: { role: "assistant", content: "Resumed task finished" } },
            { delta: {}, finish_reason: "stop" },
          ]
          return new Response(
            events.map((choice) => `data: ${JSON.stringify({ id: "test", choices: [choice] })}\n\n`).join("") +
              "data: [DONE]\n\n",
            { headers: { "Content-Type": "text/event-stream" } },
          )
        },
      })
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          gate.resolve()
          await provider.stop(true)
        }),
      )
      const tmp = yield* tmpdirScoped({
        config: {
          model: "test/test-model",
          enabled_providers: ["test"],
          formatter: false,
          lsp: false,
          provider: {
            test: {
              name: "Test",
              npm: "@ai-sdk/openai-compatible",
              options: { apiKey: "test-key", baseURL: `${provider.url.origin}/v1` },
              models: { "test-model": { name: "Test", limit: { context: 100000, output: 10000 } } },
            },
          },
        },
      })
      yield* Effect.gen(function* () {
        const sessions = yield* Session.Service
        const questions = yield* Question.Service
        const permissions = yield* Permission.Service
        const session = yield* sessions.create({ title: "HTTP resume regression" })
        const user = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          agent: "code",
          model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
          time: { created: Date.now() },
        })
        yield* sessions.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "Finish this task",
        })
        const assistant = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          parentID: user.id,
          agent: "code",
          mode: "code",
          providerID: user.model.providerID,
          modelID: user.model.modelID,
          path: { cwd: tmp, root: tmp },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now(), completed: Date.now() },
          finish: "stop",
        })
        yield* sessions.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: assistant.id,
          type: "text",
          text: "Partial work",
        })
        const listener = yield* Effect.acquireRelease(
          Effect.promise(() => Server.listen({ hostname: "127.0.0.1", port: 0 })),
          (listener) => Effect.promise(() => listener.stop(true)),
        )
        const resume = (id = assistant.id) =>
          Effect.promise(() =>
            fetch(new URL(`/kilocode/session/${session.id}/resume`, listener.url), {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-kilo-directory": tmp },
              body: JSON.stringify({ messageID: id }),
            }),
          )
        expect((yield* resume()).status).toBe(400)
        yield* sessions.updateMessage({
          ...assistant,
          error: new MessageV2.AbortedError({ message: "Stopped" }).toObject(),
        })
        expect((yield* resume(user.id)).status).toBe(400)

        const answering = yield* questions
          .ask({
            sessionID: session.id,
            questions: [
              { header: "Choice", question: "Choose an action", options: [{ label: "Wait", description: "Wait" }] },
            ],
          })
          .pipe(Effect.exit, Effect.forkChild)
        const question = yield* pollWithTimeout(
          questions.list().pipe(Effect.map((items) => items.find((item) => item.sessionID === session.id))),
          "question did not become pending",
        )
        expect((yield* resume()).status).toBe(400)
        expect(yield* questions.list()).toHaveLength(1)
        yield* questions.reject(question.id)
        yield* Fiber.join(answering)

        const approving = yield* permissions
          .ask({
            sessionID: session.id,
            permission: "bash",
            patterns: ["pwd"],
            metadata: {},
            always: [],
            ruleset: [],
          })
          .pipe(Effect.exit, Effect.forkChild)
        const permission = yield* pollWithTimeout(
          permissions.list().pipe(Effect.map((items) => items.find((item) => item.sessionID === session.id))),
          "permission did not become pending",
        )
        expect((yield* resume()).status).toBe(400)
        expect(yield* permissions.list()).toHaveLength(1)
        yield* permissions.reply({ requestID: permission.id, reply: "reject" })
        yield* Fiber.join(approving)

        expect((yield* resume()).status).toBe(200)
        yield* pollWithTimeout(
          Effect.sync(() => (calls.length > 0 ? true : undefined)),
          "resume did not start",
        )
        expect((yield* resume()).status).toBe(400)
        gate.resolve()
        const messages = yield* pollWithTimeout(
          sessions.messages({ sessionID: session.id }).pipe(
            Effect.map((messages) => {
              const last = messages.at(-1)
              return last?.info.role === "assistant" && last.info.id !== assistant.id && last.info.time.completed
                ? messages
                : undefined
            }),
          ),
          "resumed response did not complete",
          "10 seconds",
        )
        expect(messages.filter((message) => message.info.role === "user").map((message) => message.info.id)).toEqual([
          user.id,
        ])
        expect(
          messages.at(-1)?.parts.some((part) => part.type === "text" && part.text === "Resumed task finished"),
        ).toBe(true)
        expect(JSON.stringify(messages)).not.toContain("[TASK RESUMPTION]")
        expect(calls).toHaveLength(1)
        expect((yield* resume()).status).toBe(400)
        expect(calls).toHaveLength(1)
      }).pipe(provideInstanceEffect(tmp))
    }),
  30_000,
)
