import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Bus } from "../../src/bus"
import { KiloSessionPromptQueue } from "../../src/kilocode/session/prompt-queue"
import { Suggestion } from "../../src/kilocode/suggestion"
import { Question } from "../../src/question"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import { Log } from "../../src/util"
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

  test("retarget keeps older queued prompts hidden", async () => {
    // Regression: retargeting used to move the visible-message boundary forward,
    // which unhid any user prompts queued between the base and the injected
    // follow-up. Exempt the follow-up without reopening the boundary.
    const sessionID = SessionID.make("session_retarget_hide")
    const base = MessageID.make("message_b1")
    const ans = MessageID.make("message_b2")
    const queued = MessageID.make("message_b3") // queued while base was running
    const injected = MessageID.make("message_b4") // injected follow-up
    const messages = [
      user(sessionID, base),
      assistant(sessionID, ans, base),
      user(sessionID, queued),
      user(sessionID, injected),
    ]

    const ids = await Effect.runPromise(
      KiloSessionPromptQueue.enqueue(
        sessionID,
        base,
        Effect.sync(() => {
          KiloSessionPromptQueue.retarget(sessionID, injected)
          return KiloSessionPromptQueue.scope(sessionID, messages).map((item) => item.info.id)
        }),
        Effect.succeed([]),
      ),
    )

    expect(ids).not.toContain(queued)
    expect(ids).toContain(injected)
    expect(ids[ids.length - 1]).toBe(injected)
  })

  test("hasFollowup reports true only for prompts enqueued after the active slot started", async () => {
    const sessionID = SessionID.make("session_followup_semantics")
    const observed: Array<{ where: string; value: boolean }> = []
    const firstStarted = Promise.withResolvers<void>()
    const firstReleased = Promise.withResolvers<void>()
    const secondStarted = Promise.withResolvers<void>()
    const secondReleased = Promise.withResolvers<void>()

    const first = Effect.runPromise(
      KiloSessionPromptQueue.enqueue(
        sessionID,
        MessageID.make("message_followup_1"),
        Effect.gen(function* () {
          observed.push({ where: "first:start", value: KiloSessionPromptQueue.hasFollowup(sessionID) })
          firstStarted.resolve()
          yield* Effect.promise(() => firstReleased.promise)
          observed.push({ where: "first:end", value: KiloSessionPromptQueue.hasFollowup(sessionID) })
          return "first"
        }),
        Effect.succeed("first-cancelled"),
      ),
    )

    await firstStarted.promise
    // msg1 is alone — nothing newer has arrived yet.
    expect(observed[0]?.value).toBe(false)

    const second = Effect.runPromise(
      KiloSessionPromptQueue.enqueue(
        sessionID,
        MessageID.make("message_followup_2"),
        Effect.gen(function* () {
          observed.push({ where: "second:start", value: KiloSessionPromptQueue.hasFollowup(sessionID) })
          secondStarted.resolve()
          yield* Effect.promise(() => secondReleased.promise)
          return "second"
        }),
        Effect.succeed("second-cancelled"),
      ),
    )

    // Enqueueing msg2 while msg1 is still running must flip hasFollowup to true
    // for msg1's running slot.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(KiloSessionPromptQueue.hasFollowup(sessionID)).toBe(true)

    const third = Effect.runPromise(
      KiloSessionPromptQueue.enqueue(
        sessionID,
        MessageID.make("message_followup_3"),
        Effect.sync(() => {
          observed.push({ where: "third:start", value: KiloSessionPromptQueue.hasFollowup(sessionID) })
          return "third"
        }),
        Effect.succeed("third-cancelled"),
      ),
    )

    // Let msg1 finish.
    firstReleased.resolve()
    await first
    await secondStarted.promise

    // msg2 started after msg3 was enqueued, so hasFollowup should be false for
    // msg2 — everything waiting is older than msg2's activeSince snapshot.
    expect(KiloSessionPromptQueue.hasFollowup(sessionID)).toBe(false)
    secondReleased.resolve()

    expect(await second).toBe("second")
    expect(await third).toBe("third")

    const events = observed.map((item) => `${item.where}=${item.value}`)
    expect(events).toEqual(["first:start=false", "first:end=true", "second:start=false", "third:start=false"])
  })

  test("processes queued prompts without aborting the in-flight stream", async () => {
    const ready = Promise.withResolvers<void>()
    const injected = Promise.withResolvers<void>()
    const calls: number[] = []
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })

        calls.push(Date.now())
        const body =
          calls.length === 1
            ? reply({ text: "first reply", ready: ready.resolve })
            : reply({ text: "second reply", ready: injected.resolve })
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

          const one = await first
          await injected.promise
          const two = await second

          expect(calls).toHaveLength(2)

          // The in-flight stream must complete; no aborted error on msg1's reply.
          expect(one.info.role).toBe("assistant")
          if (one.info.role === "assistant") expect(one.info.error).toBeUndefined()
          expect(hasText(one, "first reply")).toBe(true)
          expect(hasText(two, "second reply")).toBe(true)

          const msgs = await Session.messages({ sessionID: session.id })
          const users = msgs.filter((msg) => msg.info.role === "user")
          const assistants = msgs.filter((msg) => msg.info.role === "assistant")
          const prompts = users.flatMap((msg) =>
            msg.parts.filter((part) => part.type === "text").map((part) => part.text),
          )
          const text = assistants.flatMap((msg) =>
            msg.parts.filter((part) => part.type === "text").map((part) => part.text),
          )
          expect(users).toHaveLength(2)
          expect(assistants).toHaveLength(2)
          expect(prompts).toContain("first prompt")
          expect(prompts).toContain("second prompt")
          expect(text).toContain("first reply")
          expect(text).toContain("second reply")

          const firstUser = users.find((msg) => hasText(msg, "first prompt"))
          const secondUser = users.find((msg) => hasText(msg, "second prompt"))
          const firstReply = assistants.find((msg) => hasText(msg, "first reply"))
          const secondReply = assistants.find((msg) => hasText(msg, "second reply"))
          if (
            firstUser?.info.role !== "user" ||
            secondUser?.info.role !== "user" ||
            firstReply?.info.role !== "assistant" ||
            secondReply?.info.role !== "assistant"
          ) {
            throw new Error("missing expected messages")
          }
          expect(firstReply.info.parentID).toBe(firstUser.info.id)
          expect(secondReply.info.parentID).toBe(secondUser.info.id)
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

          // Let msg2/msg3's enqueue capture the current version before cancel bumps it.
          await Bun.sleep(20)
          expect(calls).toHaveLength(1)

          await SessionPrompt.cancel(session.id)
          await Promise.all([first, second, third])

          // The queued prompts must never reach the LLM once cancel flushes the queue.
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
          expect(KiloSessionPromptQueue.hasFollowup(session.id)).toBe(false)
        },
      })
    } finally {
      server.stop(true)
    }
  })

  test("new prompt dismisses a pending suggestion", async () => {
    const shown = Promise.withResolvers<void>()
    const dismissed = Promise.withResolvers<void>()
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Suggestion unblock regression" })
        const offShown = Bus.subscribe(Suggestion.Event.Shown, (event) => {
          if (event.properties.sessionID === session.id) shown.resolve()
        })
        const offDismissed = Bus.subscribe(Suggestion.Event.Dismissed, (event) => {
          if (event.properties.sessionID === session.id) dismissed.resolve()
        })

        try {
          const base = Suggestion.show({
            sessionID: session.id,
            text: "Run review?",
            actions: [{ label: "Review", prompt: "/local-review-uncommitted" }],
          }).catch((err) => {
            if (err instanceof Suggestion.DismissedError) return "dismissed"
            throw err
          })

          await shown.promise
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "code",
            parts: [{ type: "text", text: "replacement prompt" }],
            noReply: true,
          })
          await dismissed.promise

          expect(await base).toBe("dismissed")
          expect(await Suggestion.list()).toEqual([])
        } finally {
          offShown()
          offDismissed()
        }
      },
    })
  })

  test("new prompt dismisses a pending question", async () => {
    const asked = Promise.withResolvers<void>()
    const rejected = Promise.withResolvers<void>()
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Question unblock regression" })
        const offAsked = Bus.subscribe(Question.Event.Asked, (event) => {
          if (event.properties.sessionID === session.id) asked.resolve()
        })
        const offRejected = Bus.subscribe(Question.Event.Rejected, (event) => {
          if (event.properties.sessionID === session.id) rejected.resolve()
        })

        try {
          const pending = Question.ask({
            sessionID: session.id,
            questions: [
              {
                header: "Continue?",
                question: "Should I continue?",
                options: [
                  { label: "Yes", description: "Go ahead" },
                  { label: "No", description: "Stop" },
                ],
              },
            ],
          }).catch((err) => {
            if (err instanceof Question.RejectedError) return "rejected"
            throw err
          })

          await asked.promise
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "code",
            parts: [{ type: "text", text: "replacement prompt" }],
            noReply: true,
          })
          await rejected.promise

          expect(await pending).toBe("rejected")
          expect(await Question.list()).toEqual([])
        } finally {
          offAsked()
          offRejected()
        }
      },
    })
  })

  test("auto-dismisses a suggestion shown after a queued prompt", async () => {
    // Reverse ordering of the "new prompt dismisses a pending suggestion" test:
    // queue the follow-up first, then open the blocker. Suggestion.show must see
    // hasFollowup=true and reject synchronously, before any pending entry or
    // Shown event is published.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_auto_suggestion")
        const started = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()

        // Slot 1: active, activeSince snapshots latest=1.
        const first = Effect.runPromise(
          KiloSessionPromptQueue.enqueue(
            sessionID,
            MessageID.make("message_auto_sug_1"),
            Effect.gen(function* () {
              started.resolve()
              yield* Effect.promise(() => release.promise)
              return "first" as const
            }),
            Effect.succeed("first-cancelled" as const),
          ),
        )
        await started.promise

        // Slot 2: enqueued while slot 1 is active → latest=2 > activeSince=1.
        const second = Effect.runPromise(
          KiloSessionPromptQueue.enqueue(
            sessionID,
            MessageID.make("message_auto_sug_2"),
            Effect.succeed("second" as const),
            Effect.succeed("second-cancelled" as const),
          ),
        )
        await Bun.sleep(10)
        expect(KiloSessionPromptQueue.hasFollowup(sessionID)).toBe(true)

        let shown = 0
        const offShown = Bus.subscribe(Suggestion.Event.Shown, (event) => {
          if (event.properties.sessionID === sessionID) shown++
        })
        try {
          await expect(
            Suggestion.show({
              sessionID,
              text: "Run review?",
              actions: [{ label: "Review", prompt: "/local-review-uncommitted" }],
            }),
          ).rejects.toBeInstanceOf(Suggestion.DismissedError)
        } finally {
          offShown()
        }
        expect(shown).toBe(0)
        expect(await Suggestion.list()).toEqual([])

        release.resolve()
        expect(await first).toBe("first")
        expect(await second).toBe("second")
      },
    })
  })

  test("auto-dismisses a question shown after a queued prompt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_auto_question")
        const started = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()

        const first = Effect.runPromise(
          KiloSessionPromptQueue.enqueue(
            sessionID,
            MessageID.make("message_auto_q_1"),
            Effect.gen(function* () {
              started.resolve()
              yield* Effect.promise(() => release.promise)
              return "first" as const
            }),
            Effect.succeed("first-cancelled" as const),
          ),
        )
        await started.promise

        const second = Effect.runPromise(
          KiloSessionPromptQueue.enqueue(
            sessionID,
            MessageID.make("message_auto_q_2"),
            Effect.succeed("second" as const),
            Effect.succeed("second-cancelled" as const),
          ),
        )
        await Bun.sleep(10)
        expect(KiloSessionPromptQueue.hasFollowup(sessionID)).toBe(true)

        let asked = 0
        const offAsked = Bus.subscribe(Question.Event.Asked, (event) => {
          if (event.properties.sessionID === sessionID) asked++
        })
        try {
          await expect(
            Question.ask({
              sessionID,
              questions: [
                {
                  header: "Continue?",
                  question: "Should I continue?",
                  options: [
                    { label: "Yes", description: "Go ahead" },
                    { label: "No", description: "Stop" },
                  ],
                },
              ],
            }),
          ).rejects.toBeInstanceOf(Question.RejectedError)
        } finally {
          offAsked()
        }
        expect(asked).toBe(0)
        expect(await Question.list()).toEqual([])

        release.resolve()
        expect(await first).toBe("first")
        expect(await second).toBe("second")
      },
    })
  })
})
