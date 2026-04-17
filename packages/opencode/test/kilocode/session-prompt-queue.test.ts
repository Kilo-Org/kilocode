import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloSessionPromptQueue } from "../../src/kilocode/session/prompt-queue"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function line(input: unknown) {
  return `data: ${JSON.stringify(input)}\n\n`
}

function chunk(input: { delta?: Record<string, unknown>; finish?: string }) {
  return {
    id: "chatcmpl-queue-test",
    object: "chat.completion.chunk",
    choices: [
      {
        delta: input.delta ?? {},
        ...(input.finish ? { finish_reason: input.finish } : {}),
      },
    ],
  }
}

function reply(input: { text: string; ready?: () => void; wait?: Promise<unknown> }) {
  const enc = new TextEncoder()
  const head = line(chunk({ delta: { role: "assistant" } }))
  const tail = [
    line(chunk({ delta: { content: input.text } })),
    line(chunk({ finish: "stop" })),
    "data: [DONE]\n\n",
  ].join("")

  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(enc.encode(head))
      input.ready?.()
      const done = () => {
        ctrl.enqueue(enc.encode(tail))
        ctrl.close()
      }
      if (input.wait) {
        void input.wait.then(done)
        return
      }
      done()
    },
  })
}

function hasText(msg: Awaited<ReturnType<typeof SessionPrompt.prompt>>, text: string) {
  return msg.parts.some((part) => part.type === "text" && part.text.includes(text))
}

function user(sessionID: SessionID, id: MessageID): MessageV2.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "code",
      model: { providerID: ProviderID.make("test"), modelID: ModelID.make("model") },
    },
    parts: [],
  }
}

function assistant(sessionID: SessionID, id: MessageID, parentID: MessageID): MessageV2.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      time: { created: 1, completed: 2 },
      parentID,
      modelID: ModelID.make("model"),
      providerID: ProviderID.make("test"),
      mode: "code",
      agent: "code",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
    },
    parts: [],
  }
}

describe("session prompt queue", () => {
  test("scopes queued turns without moving prior assistant history", async () => {
    const sessionID = SessionID.make("session_scope")
    const one = MessageID.make("message_01")
    const ans = MessageID.make("message_02")
    const two = MessageID.make("message_03")
    const three = MessageID.make("message_04")
    const messages = [
      user(sessionID, one),
      assistant(sessionID, ans, one),
      user(sessionID, two),
      user(sessionID, three),
    ]

    const ids = await Effect.runPromise(
      KiloSessionPromptQueue.enqueue(
        sessionID,
        two,
        Effect.sync(() => KiloSessionPromptQueue.scope(sessionID, messages).map((item) => item.info.id)),
        Effect.succeed([]),
      ),
    )

    expect(ids).toEqual([one, ans, two])
  })

  test("moves queued target to the end when prior-turn messages come after it", async () => {
    // Regression: when a user queues a prompt while a turn is still running,
    // the queued message's time_created falls before later assistant steps of
    // that turn. Ordering by time_created alone would leave the queued prompt
    // in the middle of the prior turn's messages, ending the next model request
    // with an assistant message and tripping Anthropic's prefill rejection.
    const sessionID = SessionID.make("session_queue_mid_turn")
    const m1 = MessageID.make("message_10")
    const a1 = MessageID.make("message_20")
    const m2 = MessageID.make("message_30")
    const a2step1 = MessageID.make("message_40")
    const m3 = MessageID.make("message_50") // queued mid-turn
    const a2step2 = MessageID.make("message_60")
    const a2final = MessageID.make("message_70")
    const messages = [
      user(sessionID, m1),
      assistant(sessionID, a1, m1),
      user(sessionID, m2),
      assistant(sessionID, a2step1, m2),
      user(sessionID, m3),
      assistant(sessionID, a2step2, m2),
      assistant(sessionID, a2final, m2),
    ]

    const ids = await Effect.runPromise(
      KiloSessionPromptQueue.enqueue(
        sessionID,
        m3,
        Effect.sync(() => KiloSessionPromptQueue.scope(sessionID, messages).map((item) => item.info.id)),
        Effect.succeed([]),
      ),
    )

    expect(ids).toEqual([m1, a1, m2, a2step1, a2step2, a2final, m3])
    expect(ids[ids.length - 1]).toBe(m3)
  })

  test("keeps the target turn's own assistant steps grouped at the end", async () => {
    // After the first step of a queued turn has produced an assistant message,
    // subsequent scope() calls should keep the target user together with its
    // own turn's assistants (not interleaved with a prior turn's tail).
    const sessionID = SessionID.make("session_queue_step_two")
    const m1 = MessageID.make("message_01a")
    const a1 = MessageID.make("message_02a")
    const m2 = MessageID.make("message_03a") // queued mid-turn
    const a1tail = MessageID.make("message_04a")
    const a2step1 = MessageID.make("message_05a")
    const messages = [
      user(sessionID, m1),
      assistant(sessionID, a1, m1),
      user(sessionID, m2),
      assistant(sessionID, a1tail, m1), // prior turn's tail was written after m2
      assistant(sessionID, a2step1, m2),
    ]

    const ids = await Effect.runPromise(
      KiloSessionPromptQueue.enqueue(
        sessionID,
        m2,
        Effect.sync(() => KiloSessionPromptQueue.scope(sessionID, messages).map((item) => item.info.id)),
        Effect.succeed([]),
      ),
    )

    expect(ids).toEqual([m1, a1, a1tail, m2, a2step1])
  })

  test("continues a queued prompt after the active run finishes", async () => {
    const ready = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const calls: number[] = []
    const replies = ["first reply", "second reply", "third reply"]
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })

        calls.push(Date.now())
        const body =
          calls.length === 1
            ? reply({ text: replies[0], ready: ready.resolve, wait: release.promise })
            : reply({ text: replies[calls.length - 1] ?? "extra reply" })
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    try {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              enabled_providers: ["alibaba"],
              provider: {
                alibaba: {
                  options: {
                    apiKey: "test-key",
                    baseURL: `${server.url.origin}/v1`,
                  },
                },
              },
              agent: {
                code: {
                  model: "alibaba/qwen-plus",
                },
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Queued prompt regression" })
          const first = SessionPrompt.prompt({
            sessionID: session.id,
            agent: "code",
            parts: [{ type: "text", text: "first prompt" }],
          })

          await ready.promise

          const second = SessionPrompt.prompt({
            sessionID: session.id,
            agent: "code",
            parts: [{ type: "text", text: "second prompt" }],
          })
          const third = SessionPrompt.prompt({
            sessionID: session.id,
            agent: "code",
            parts: [{ type: "text", text: "third prompt" }],
          })

          await Bun.sleep(20)
          expect(calls).toHaveLength(1)
          const queued = await Session.messages({ sessionID: session.id })
          expect(queued.filter((msg) => msg.info.role === "user")).toHaveLength(3)
          expect(queued.filter((msg) => msg.info.role === "assistant")).toHaveLength(1)

          release.resolve()
          await first
          const two = await second
          const three = await third

          expect(hasText(two, "second reply")).toBe(true)
          expect(hasText(three, "third reply")).toBe(true)
          expect(calls).toHaveLength(3)

          const msgs = await Session.messages({ sessionID: session.id })
          const users = msgs.filter((msg) => msg.info.role === "user")
          const assistants = msgs.filter((msg) => msg.info.role === "assistant")
          const text = assistants.flatMap((msg) =>
            msg.parts.filter((part) => part.type === "text").map((part) => part.text),
          )
          expect(users).toHaveLength(3)
          expect(assistants).toHaveLength(3)
          expect(text).toContain("first reply")
          expect(text).toContain("second reply")
          expect(text).toContain("third reply")
          for (const [index, item] of assistants.entries()) {
            const user = users[index]?.info
            if (item.info.role !== "assistant" || user?.role !== "user") throw new Error("missing turn")
            expect(item.info.parentID).toBe(user.id)
          }
        },
      })
    } finally {
      server.stop(true)
    }
  })

  test("cancel drops queued prompts and resets internal state", async () => {
    const ready = Promise.withResolvers<void>()
    const calls: number[] = []
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })

        calls.push(Date.now())
        const body = reply({ text: "first reply", ready: ready.resolve, wait: new Promise(() => {}) })
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    try {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              enabled_providers: ["alibaba"],
              provider: {
                alibaba: {
                  options: { apiKey: "test-key", baseURL: `${server.url.origin}/v1` },
                },
              },
              agent: { code: { model: "alibaba/qwen-plus" } },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Queued cancel regression" })
          const first = SessionPrompt.prompt({
            sessionID: session.id,
            agent: "code",
            parts: [{ type: "text", text: "first prompt" }],
          })
          await ready.promise

          const second = SessionPrompt.prompt({
            sessionID: session.id,
            agent: "code",
            parts: [{ type: "text", text: "second prompt" }],
          })
          const third = SessionPrompt.prompt({
            sessionID: session.id,
            agent: "code",
            parts: [{ type: "text", text: "third prompt" }],
          })

          await Bun.sleep(20)
          expect(calls).toHaveLength(1)

          await SessionPrompt.cancel(session.id)
          await Promise.all([first, second, third])

          expect(calls).toHaveLength(1)
          const msgs = await Session.messages({ sessionID: session.id })
          const assistants = msgs.filter((msg) => msg.info.role === "assistant")
          expect(assistants).toHaveLength(1)
          expect(msgs.filter((msg) => msg.info.role === "user")).toHaveLength(3)

          // Internal state should have no lingering tail/version/target entries after the last release.
          const ids = await Effect.runPromise(
            KiloSessionPromptQueue.enqueue(
              session.id,
              MessageID.make("message_probe"),
              Effect.succeed(KiloSessionPromptQueue.scope(session.id, []).map((item) => item.info.id)),
              Effect.succeed([]),
            ),
          )
          expect(ids).toEqual([])
        },
      })
    } finally {
      server.stop(true)
    }
  })
})
