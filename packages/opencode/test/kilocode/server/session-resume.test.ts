import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef } from "@/effect/instance-ref"
import { Server } from "@/server/server"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID } from "@/session/schema"
import { Question } from "@/question"
import { Permission } from "@/permission"
import { disposeAllInstances, reloadTestInstance, tmpdir } from "../../fixture/fixture"
import { resetDatabase } from "../../fixture/db"
import { pollWithTimeout } from "../../lib/effect"

const password = Flag.KILO_SERVER_PASSWORD

afterEach(async () => {
  Flag.KILO_SERVER_PASSWORD = password
  await disposeAllInstances()
  await resetDatabase()
})

test("HTTP resume preserves the user turn and refuses blocked, completed, and stale requests", async () => {
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
        {
          headers: { "Content-Type": "text/event-stream" },
        },
      )
    },
  })
  await using tmp = await tmpdir({
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
  const context = await reloadTestInstance({ directory: tmp.path })
  const run = <A, E>(work: Effect.Effect<A, E, Session.Service | Question.Service | Permission.Service>) =>
    AppRuntime.runPromise(work.pipe(Effect.provideService(InstanceRef, context)))
  const seed = await run(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
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
        path: { cwd: tmp.path, root: tmp.path },
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
      return { session, user, assistant }
    }),
  )
  const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
  const resume = (id = seed.assistant.id) =>
    fetch(new URL(`/kilocode/session/${seed.session.id}/resume`, listener.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
      body: JSON.stringify({ messageID: id }),
    })
  try {
    expect((await resume()).status).toBe(400)
    await run(
      Session.Service.use((sessions) =>
        sessions.updateMessage({
          ...seed.assistant,
          error: new MessageV2.AbortedError({ message: "Stopped" }).toObject(),
        }),
      ),
    )
    expect((await resume(seed.user.id)).status).toBe(400)

    const answering = run(
      Question.Service.use((questions) =>
        questions.ask({
          sessionID: seed.session.id,
          questions: [
            { header: "Choice", question: "Choose an action", options: [{ label: "Wait", description: "Wait" }] },
          ],
        }),
      ).pipe(Effect.exit),
    )
    const question = await run(
      pollWithTimeout(
        Question.Service.use((questions) => questions.list()).pipe(
          Effect.map((items) => items.find((item) => item.sessionID === seed.session.id)),
        ),
        "question did not become pending",
      ),
    )
    expect((await resume()).status).toBe(400)
    expect(await run(Question.Service.use((questions) => questions.list()))).toHaveLength(1)
    await run(Question.Service.use((questions) => questions.reject(question.id)))
    await answering

    const approving = run(
      Permission.Service.use((permissions) =>
        permissions.ask({
          sessionID: seed.session.id,
          permission: "bash",
          patterns: ["pwd"],
          metadata: {},
          always: [],
          ruleset: [],
        }),
      ).pipe(Effect.exit),
    )
    const permission = await run(
      pollWithTimeout(
        Permission.Service.use((permissions) => permissions.list()).pipe(
          Effect.map((items) => items.find((item) => item.sessionID === seed.session.id)),
        ),
        "permission did not become pending",
      ),
    )
    expect((await resume()).status).toBe(400)
    expect(await run(Permission.Service.use((permissions) => permissions.list()))).toHaveLength(1)
    await run(Permission.Service.use((permissions) => permissions.reply({ requestID: permission.id, reply: "reject" })))
    await approving

    expect((await resume()).status).toBe(200)
    await run(
      pollWithTimeout(
        Effect.sync(() => (calls.length > 0 ? true : undefined)),
        "resume did not start",
      ),
    )
    expect((await resume()).status).toBe(400)
    gate.resolve()
    const messages = await run(
      pollWithTimeout(
        Session.Service.use((sessions) => sessions.messages({ sessionID: seed.session.id })).pipe(
          Effect.map((messages) => {
            const last = messages.at(-1)
            return last?.info.role === "assistant" && last.info.id !== seed.assistant.id && last.info.time.completed
              ? messages
              : undefined
          }),
        ),
        "resumed response did not complete",
        "10 seconds",
      ),
    )
    expect(messages.filter((message) => message.info.role === "user").map((message) => message.info.id)).toEqual([
      seed.user.id,
    ])
    expect(messages.at(-1)?.parts.some((part) => part.type === "text" && part.text === "Resumed task finished")).toBe(
      true,
    )
    expect(JSON.stringify(messages)).not.toContain("[TASK RESUMPTION]")
    expect(calls).toHaveLength(1)
    expect((await resume()).status).toBe(400)
    expect(calls).toHaveLength(1)
  } finally {
    gate.resolve()
    await listener.stop(true)
    await provider.stop(true)
  }
}, 30_000)
