import path from "path"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import { Bus } from "../../src/bus"
import { AppRuntime } from "../../src/effect/app-runtime"
import { InstanceRef } from "../../src/effect/instance-ref"
import { KiloSessionCompaction } from "@/kilocode/session/compaction"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"
import { KiloSession } from "@/kilocode/session"
import { Suggestion } from "../../src/kilocode/suggestion"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { InstanceStore } from "../../src/project/instance-store"
import { provideTestInstance } from "../fixture/fixture"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { disposeTestRuntime, provideInstance, testInstanceStoreLayer, tmpdir } from "../fixture/fixture"
import { Flag } from "@opencode-ai/core/flag/flag"
import { remove as cleanup } from "./cleanup"

Log.init({ print: false })

const previous = Flag.KILO_DB
const dbfile = path.join(os.tmpdir(), `kilo-prompt-queue-${process.pid}-${crypto.randomUUID()}.db`)

beforeAll(async () => {
  await fs.rm(dbfile, { force: true })
  Flag.KILO_DB = dbfile
})

afterAll(async () => {
  await AppRuntime.dispose()
  await disposeTestRuntime()
  Flag.KILO_DB = previous
  await Promise.all([dbfile, `${dbfile}-wal`, `${dbfile}-shm`].map(cleanup))
})

const store = {
  updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.promise(() => sessions.updateMessage(msg)),
  updatePart: <T extends MessageV2.Part>(part: T) => Effect.promise(() => sessions.updatePart(part)),
}

const sessions = {
  create: (input?: Parameters<Session.Interface["create"]>[0]) =>
    Effect.runPromise(Session.Service.use((svc) => svc.create(input)).pipe(Effect.provide(Session.defaultLayer))),
  messages: (input: Parameters<Session.Interface["messages"]>[0]) =>
    Effect.runPromise(Session.Service.use((svc) => svc.messages(input)).pipe(Effect.provide(Session.defaultLayer))),
  updateMessage: <T extends MessageV2.Info>(msg: T) =>
    Effect.runPromise(Session.Service.use((svc) => svc.updateMessage(msg)).pipe(Effect.provide(Session.defaultLayer))),
  updatePart: <T extends MessageV2.Part>(part: T) =>
    Effect.runPromise(Session.Service.use((svc) => svc.updatePart(part)).pipe(Effect.provide(Session.defaultLayer))),
}

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

function hasText(msg: MessageV2.WithParts, text: string) {
  return msg.parts.some((part) => part.type === "text" && part.text.includes(text))
}

function scoped<T>(dir: string, fn: (prompt: SessionPrompt.Interface) => Promise<T>) {
  return Effect.runPromise(
    SessionPrompt.Service.use((prompt) => Effect.promise(() => fn(prompt))).pipe(
      Effect.provide(SessionPrompt.defaultLayer),
      provideInstance(dir),
      Effect.provide(testInstanceStoreLayer),
      Effect.scoped,
    ),
  )
}

// Find the last non-system message in an OpenAI-compatible request body. Kept
// tolerant: we only care about role invariants, not the exact content shape,
// because providers may serialize `content` as a string or as a parts array.
function lastConversational(body: Record<string, unknown>): { role: string; content: unknown } | undefined {
  const msgs = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : []
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (!msg || typeof msg !== "object") continue
    const role = typeof msg.role === "string" ? msg.role : undefined
    if (!role || role === "system") continue
    return { role, content: msg.content }
  }
  return undefined
}

function user(sessionID: SessionID, id: MessageID): MessageV2.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "code",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
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
      modelID: ModelV2.ID.make("model"),
      providerID: ProviderV2.ID.make("test"),
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
    const one = MessageID.make("msg_01")
    const ans = MessageID.make("msg_02")
    const two = MessageID.make("msg_03")
    const three = MessageID.make("msg_04")
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
    const m1 = MessageID.make("msg_10")
    const a1 = MessageID.make("msg_20")
    const m2 = MessageID.make("msg_30")
    const a2step1 = MessageID.make("msg_40")
    const m3 = MessageID.make("msg_50") // queued mid-turn
    const a2step2 = MessageID.make("msg_60")
    const a2final = MessageID.make("msg_70")
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
    const m1 = MessageID.make("msg_01a")
    const a1 = MessageID.make("msg_02a")
    const m2 = MessageID.make("msg_03a") // queued mid-turn
    const a1tail = MessageID.make("msg_04a")
    const a2step1 = MessageID.make("msg_05a")
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
    const base = MessageID.make("msg_b1")
    const ans = MessageID.make("msg_b2")
    const queued = MessageID.make("msg_b3") // queued while base was running
    const injected = MessageID.make("msg_b4") // injected follow-up
    const messages = [
      user(sessionID, base),
      assistant(sessionID, ans, base),
      user(sessionID, queued),
      user(sessionID, injected),
    ]

    const result = await Effect.runPromise(
      KiloSessionPromptQueue.enqueue(
        sessionID,
        base,
        Effect.sync(() => {
          KiloSessionPromptQueue.retarget(sessionID, injected)
          return {
            active: KiloSessionPromptQueue.active(sessionID),
            ids: KiloSessionPromptQueue.scope(sessionID, messages).map((item) => item.info.id),
          }
        }),
        Effect.succeed({ active: undefined, ids: [] }),
      ),
    )

    expect(result.active).toBe(base)
    expect(result.ids).not.toContain(queued)
    expect(result.ids).toContain(injected)
    expect(result.ids[result.ids.length - 1]).toBe(injected)
  })

  test("keeps auto-compaction markers created during a queued turn visible", async () => {
    // Regression for ses_20d25cccbffeVAw7Y9XGfL9p5O: an overflow inside a queued
    // turn creates an auto-compaction user message after the queued prompt. If
    // scope() hides that marker, runLoop never processes the compaction task and
    // instead retries the same oversized request until compaction is exhausted.
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await sessions.create({ title: "Queued compaction regression" })
        const first = MessageID.ascending()
        const ans = MessageID.ascending()
        const queued = MessageID.ascending()

        await sessions.updateMessage(user(session.id, first).info)
        await sessions.updateMessage(assistant(session.id, ans, first).info)
        await sessions.updateMessage(user(session.id, queued).info)

        const result = await Effect.runPromise(
          KiloSessionPromptQueue.enqueue(
            session.id,
            queued,
            Effect.promise(async () => {
              await Effect.runPromise(
                KiloSessionCompaction.create({
                  session: store,
                  sessionID: session.id,
                  agent: "code",
                  model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
                  auto: true,
                  overflow: true,
                }),
              )
              const messages = await sessions.messages({ sessionID: session.id })
              const compact = messages.find((msg) => msg.parts.some((part) => part.type === "compaction"))?.info.id
              return { compact, ids: KiloSessionPromptQueue.scope(session.id, messages).map((item) => item.info.id) }
            }),
            Effect.succeed({ compact: undefined, ids: [] }),
          ),
        )

        if (!result.compact) throw new Error("missing compaction marker")
        expect(result.ids).toEqual([first, ans, queued, result.compact])
        expect(result.ids[result.ids.length - 1]).toBe(result.compact)
      },
    })
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
        MessageID.make("msg_followup_1"),
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
        MessageID.make("msg_followup_2"),
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
        MessageID.make("msg_followup_3"),
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
    const bodies: Array<Record<string, unknown>> = []
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })

        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
        bodies.push(body)
        calls.push(Date.now())
        const stream =
          calls.length === 1
            ? reply({ text: "first reply", ready: ready.resolve })
            : reply({ text: "second reply", ready: injected.resolve })
        return new Response(stream, {
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

      await provideTestInstance({
        directory: tmp.path,
        fn: async () =>
          scoped(tmp.path, async (prompt) => {
            const session = await sessions.create({ title: "Queued prompt regression" })
            const first = Effect.runPromise(
              prompt.prompt({
                sessionID: session.id,
                agent: "code",
                parts: [{ type: "text", text: "first prompt" }],
              }),
            )

            await ready.promise

            const second = Effect.runPromise(
              prompt.prompt({
                sessionID: session.id,
                agent: "code",
                parts: [{ type: "text", text: "second prompt" }],
              }),
            )

            const one = await first
            await injected.promise
            const two = await second

            expect(calls).toHaveLength(2)

            // The in-flight stream must complete; no aborted error on msg1's reply.
            expect(one.info.role).toBe("assistant")
            if (one.info.role === "assistant") expect(one.info.error).toBeUndefined()
            expect(hasText(one, "first reply")).toBe(true)
            expect(hasText(two, "second reply")).toBe(true)

            const msgs = await sessions.messages({ sessionID: session.id })
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

            // Regression for #9492: the second LLM request must end with the
            // queued user prompt, not an assistant tail from the prior turn.
            // Anthropic's API rejects requests whose final message is assistant
            // (prefill), and scope() is supposed to partition the queued target
            // turn to the end before the model request is built.
            expect(bodies).toHaveLength(2)
            const second2 = bodies[1]
            expect(JSON.stringify(second2)).toContain("second prompt")
            const tail = lastConversational(second2)
            expect(tail?.role).toBe("user")
            expect(JSON.stringify(tail?.content)).toContain("second prompt")
          }),
      })
    } finally {
      server.stop(true)
    }
  })

  test("bridges legacy instance context for prompts after a completed turn", async () => {
    const calls: number[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })

        calls.push(Date.now())
        const text = calls.length === 1 ? "first reply" : "second reply"
        return new Response(reply({ text }), {
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
              agent: { plan: { model: "alibaba/qwen-plus" } },
            }),
          )
        },
      })

      const ctx = await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory: tmp.path })))
      const session = await AppRuntime.runPromise(
        Session.Service.use((svc) => svc.create({ title: "Sequential prompt context regression" })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )

      const first = await AppRuntime.runPromise(
        SessionPrompt.Service.use((prompt) =>
          prompt.prompt({
            sessionID: session.id,
            agent: "plan",
            parts: [{ type: "text", text: "first prompt" }],
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )
      const second = await AppRuntime.runPromise(
        SessionPrompt.Service.use((prompt) =>
          prompt.prompt({
            sessionID: session.id,
            agent: "plan",
            parts: [{ type: "text", text: "second prompt" }],
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      expect(calls).toHaveLength(2)
      expect(hasText(first, "first reply")).toBe(true)
      expect(hasText(second, "second reply")).toBe(true)
    } finally {
      server.stop(true)
    }
  })

  test("cancel on a session with no active tail is a no-op and does not leak state", async () => {
    const sessionID = SessionID.make("session_cancel_noop")

    await Effect.runPromise(KiloSessionPromptQueue.cancel(sessionID))

    expect(KiloSessionPromptQueue._hasInternalState(sessionID)).toBe(false)

    const result = await Effect.runPromise(
      KiloSessionPromptQueue.enqueue(
        sessionID,
        MessageID.make("msg_probe"),
        Effect.succeed("work executed"),
        Effect.succeed("cancelled returned"),
      ),
    )

    expect(result).toBe("work executed")
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

      await provideTestInstance({
        directory: tmp.path,
        fn: async () =>
          scoped(tmp.path, async (prompt) => {
            const session = await sessions.create({ title: "Queued cancel regression" })
            const first = Effect.runPromise(
              prompt.prompt({
                sessionID: session.id,
                agent: "code",
                parts: [{ type: "text", text: "first prompt" }],
              }),
            )
            await ready.promise

            const second = Effect.runPromise(
              prompt.prompt({
                sessionID: session.id,
                agent: "code",
                parts: [{ type: "text", text: "second prompt" }],
              }),
            )
            const third = Effect.runPromise(
              prompt.prompt({
                sessionID: session.id,
                agent: "code",
                parts: [{ type: "text", text: "third prompt" }],
              }),
            )

            // Let msg2/msg3's enqueue capture the current version before cancel bumps it.
            await Bun.sleep(20)
            expect(calls).toHaveLength(1)

            await Effect.runPromise(prompt.cancel(session.id))
            await Promise.all([first, second, third])

            // The queued prompts must never reach the LLM once cancel flushes the queue.
            expect(calls).toHaveLength(1)
            const msgs = await sessions.messages({ sessionID: session.id })
            const assistants = msgs.filter((msg) => msg.info.role === "assistant")
            expect(assistants).toHaveLength(1)
            expect(msgs.filter((msg) => msg.info.role === "user")).toHaveLength(3)

            // Internal state should have no lingering tail/version/target entries after the last release.
            const ids = await Effect.runPromise(
              KiloSessionPromptQueue.enqueue(
                session.id,
                MessageID.make("msg_probe"),
                Effect.succeed(KiloSessionPromptQueue.scope(session.id, []).map((item) => item.info.id)),
                Effect.succeed([]),
              ),
            )
            expect(ids).toEqual([])
            expect(KiloSessionPromptQueue.hasFollowup(session.id)).toBe(false)
          }),
      })
    } finally {
      server.stop(true)
    }
  })

  test("new prompt dismisses a pending suggestion", async () => {
    const shown = Promise.withResolvers<void>()
    const dismissed = Promise.withResolvers<void>()
    await using tmp = await tmpdir({ git: true })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () =>
        scoped(tmp.path, async (prompt) => {
          const session = await sessions.create({ title: "Suggestion unblock regression" })
          const offShown = Bus.subscribe(Suggestion.Event.Shown, (event) => {
            if (event.properties.sessionID === session.id) shown.resolve()
          })
          const offDismissed = Bus.subscribe(Suggestion.Event.Dismissed, (event) => {
            if (event.properties.sessionID === session.id) dismissed.resolve()
          })

          try {
            const base = Suggestion.show({
              sessionID: session.id,
              text: "Continue with the task?",
              actions: [{ label: "Continue", prompt: "Continue with the task" }],
            }).catch((err) => {
              if (err instanceof Suggestion.DismissedError) return "dismissed"
              throw err
            })

            await shown.promise
            await Effect.runPromise(
              prompt.prompt({
                sessionID: session.id,
                agent: "code",
                parts: [{ type: "text", text: "replacement prompt" }],
                noReply: true,
              }),
            )
            await dismissed.promise

            expect(await base).toBe("dismissed")
            expect(await Suggestion.list()).toEqual([])
          } finally {
            offShown()
            offDismissed()
          }
        }),
    })
  })

  test("auto-dismisses a suggestion shown after a queued prompt", async () => {
    // Reverse ordering of the "new prompt dismisses a pending suggestion" test:
    // queue the follow-up first, then open the blocker. Suggestion.show must see
    // hasFollowup=true and reject synchronously, before any pending entry or
    // Shown event is published.
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_auto_suggestion")
        const started = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()

        // Slot 1: active, activeSince snapshots latest=1.
        const first = Effect.runPromise(
          KiloSessionPromptQueue.enqueue(
            sessionID,
            MessageID.make("msg_auto_sug_1"),
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
            MessageID.make("msg_auto_sug_2"),
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
              text: "Continue with the task?",
              actions: [{ label: "Continue", prompt: "Continue with the task" }],
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

  // kilocode_change start - session.queue.changed event surface + snapshot accessor
  describe("session.queue.changed", () => {
    test("snapshot() returns an empty list for an unknown session", () => {
      expect(KiloSessionPromptQueue.snapshot(SessionID.make("session_unknown"))).toEqual([])
    })

    test("enqueueing on an idle session does not transiently publish a non-empty snapshot", async () => {
      // A prompt enqueued into an idle session starts almost immediately, so
      // it must never appear in the waiting list (and must not emit any
      // session.queue.changed event whose queued list is non-empty).
      await using tmp = await tmpdir({ git: true })
      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const sessionID = SessionID.make("session_queue_idle")
          const events: Array<{ type: string; queued: string[] }> = []
          const off = Bus.subscribe(KiloSession.Event.QueueChanged, (event) => {
            events.push({ type: event.type, queued: [...(event.properties.queued as readonly string[])] })
          })
          try {
            await Effect.runPromise(
              KiloSessionPromptQueue.enqueue(
                sessionID,
                MessageID.make("msg_idle_1"),
                Effect.succeed("done"),
                Effect.succeed("cancelled"),
              ),
            )
            expect(KiloSessionPromptQueue.snapshot(sessionID)).toEqual([])
            expect(events).toEqual([])
          } finally {
            off()
          }
        },
      })
    })

    test("enqueueing while busy appends to the FIFO snapshot and emits the event", async () => {
      await using tmp = await tmpdir({ git: true })
      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const sessionID = SessionID.make("session_queue_busy")
          const events: Array<{ sessionID: string; queued: string[] }> = []
          const off = Bus.subscribe(KiloSession.Event.QueueChanged, (event) => {
            if (event.properties.sessionID === sessionID) {
              events.push({
                sessionID: event.properties.sessionID as string,
                queued: [...(event.properties.queued as readonly string[])],
              })
            }
          })

          const firstStarted = Promise.withResolvers<void>()
          const firstRelease = Promise.withResolvers<void>()
          const m1 = MessageID.make("msg_busy_1")
          const m2 = MessageID.make("msg_busy_2")
          const m3 = MessageID.make("msg_busy_3")

          try {
            const first = Effect.runPromise(
              KiloSessionPromptQueue.enqueue(
                sessionID,
                m1,
                Effect.gen(function* () {
                  firstStarted.resolve()
                  yield* Effect.promise(() => firstRelease.promise)
                  return "first" as const
                }),
                Effect.succeed("first-cancelled" as const),
              ),
            )
            await firstStarted.promise

            // Idle-start for slot 1 must not have emitted anything.
            expect(KiloSessionPromptQueue.snapshot(sessionID)).toEqual([])
            expect(events).toEqual([])

            const second = Effect.runPromise(
              KiloSessionPromptQueue.enqueue(
                sessionID,
                m2,
                Effect.succeed("second" as const),
                Effect.succeed("second-cancelled" as const),
              ),
            )
            const third = Effect.runPromise(
              KiloSessionPromptQueue.enqueue(
                sessionID,
                m3,
                Effect.succeed("third" as const),
                Effect.succeed("third-cancelled" as const),
              ),
            )

            // FIFO order is preserved: msg_busy_2 then msg_busy_3.
            expect(KiloSessionPromptQueue.snapshot(sessionID)).toEqual([m2, m3])
            // Publishes are fire-and-forget microtasks; let them flush.
            await Bun.sleep(10)
            expect(events).toEqual([
              { sessionID, queued: [m2] },
              { sessionID, queued: [m2, m3] },
            ])

            firstRelease.resolve()
            expect(await first).toBe("first")
            expect(await second).toBe("second")
            expect(await third).toBe("third")
          } finally {
            off()
          }
        },
      })
    })

    test("a waiting slot starting running shrinks the snapshot and emits the event", async () => {
      await using tmp = await tmpdir({ git: true })
      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const sessionID = SessionID.make("session_queue_start")
          const events: Array<{ queued: string[] }> = []
          const off = Bus.subscribe(KiloSession.Event.QueueChanged, (event) => {
            if (event.properties.sessionID === sessionID) {
              events.push({ queued: [...(event.properties.queued as readonly string[])] })
            }
          })

          const firstStarted = Promise.withResolvers<void>()
          const firstRelease = Promise.withResolvers<void>()
          const secondStarted = Promise.withResolvers<void>()
          const secondRelease = Promise.withResolvers<void>()
          const m1 = MessageID.make("msg_start_1")
          const m2 = MessageID.make("msg_start_2")

          try {
            const first = Effect.runPromise(
              KiloSessionPromptQueue.enqueue(
                sessionID,
                m1,
                Effect.gen(function* () {
                  firstStarted.resolve()
                  yield* Effect.promise(() => firstRelease.promise)
                  return "first" as const
                }),
                Effect.succeed("first-cancelled" as const),
              ),
            )
            await firstStarted.promise

            const second = Effect.runPromise(
              KiloSessionPromptQueue.enqueue(
                sessionID,
                m2,
                Effect.gen(function* () {
                  secondStarted.resolve()
                  yield* Effect.promise(() => secondRelease.promise)
                  return "second" as const
                }),
                Effect.succeed("second-cancelled" as const),
              ),
            )

            // msg2 is waiting behind msg1.
            expect(KiloSessionPromptQueue.snapshot(sessionID)).toEqual([m2])
            await Bun.sleep(10)
            expect(events.map((e) => e.queued)).toEqual([[m2]])

            // Release msg1; msg2 takes over and the waiting list drops to empty.
            firstRelease.resolve()
            await secondStarted.promise

            expect(KiloSessionPromptQueue.snapshot(sessionID)).toEqual([])
            await Bun.sleep(10)
            expect(events.map((e) => e.queued)).toEqual([[m2], []])

            secondRelease.resolve()
            expect(await first).toBe("first")
            expect(await second).toBe("second")
          } finally {
            off()
          }
        },
      })
    })

    test("cancel empties the snapshot and emits an empty list", async () => {
      await using tmp = await tmpdir({ git: true })
      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const sessionID = SessionID.make("session_queue_cancel")
          const events: Array<{ queued: string[] }> = []
          const off = Bus.subscribe(KiloSession.Event.QueueChanged, (event) => {
            if (event.properties.sessionID === sessionID) {
              events.push({ queued: [...(event.properties.queued as readonly string[])] })
            }
          })

          const firstStarted = Promise.withResolvers<void>()
          const firstRelease = Promise.withResolvers<void>()
          const m1 = MessageID.make("msg_cancel_1")
          const m2 = MessageID.make("msg_cancel_2")
          const m3 = MessageID.make("msg_cancel_3")

          try {
            const first = Effect.runPromise(
              KiloSessionPromptQueue.enqueue(
                sessionID,
                m1,
                Effect.gen(function* () {
                  firstStarted.resolve()
                  yield* Effect.promise(() => firstRelease.promise)
                  return "first" as const
                }),
                Effect.succeed("first-cancelled" as const),
              ),
            )
            await firstStarted.promise

            const second = Effect.runPromise(
              KiloSessionPromptQueue.enqueue(
                sessionID,
                m2,
                Effect.succeed("second" as const),
                Effect.succeed("second-cancelled" as const),
              ),
            )
            const third = Effect.runPromise(
              KiloSessionPromptQueue.enqueue(
                sessionID,
                m3,
                Effect.succeed("third" as const),
                Effect.succeed("third-cancelled" as const),
              ),
            )

            expect(KiloSessionPromptQueue.snapshot(sessionID)).toEqual([m2, m3])
            await Bun.sleep(10)
            const beforeCancel = events.length
            expect(beforeCancel).toBeGreaterThan(0)

            await Effect.runPromise(KiloSessionPromptQueue.cancel(sessionID))

            // The most recent emission must be the empty list, and the snapshot
            // must be empty for downstream replay callers.
            expect(KiloSessionPromptQueue.snapshot(sessionID)).toEqual([])
            await Bun.sleep(10)
            expect(events.length).toBeGreaterThan(beforeCancel)
            expect(events.at(-1)?.queued).toEqual([])
            expect(events.slice(beforeCancel).every((e) => e.queued.length === 0)).toBe(true)

            firstRelease.resolve()
            expect(await first).toBe("first")
            // Cancel bumped the version, so the queued slots return their
            // cancelled effect instead of running their work.
            expect(await second).toBe("second-cancelled")
            expect(await third).toBe("third-cancelled")
          } finally {
            off()
          }
        },
      })
    })

    test("cancel on an idle session suppresses the empty→empty emission", async () => {
      // Steady-state no-op empty→empty emissions are intentionally suppressed
      // by the queue to keep the bus quiet. Replay uses snapshot() directly
      // and is therefore never affected by this suppression.
      await using tmp = await tmpdir({ git: true })
      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const sessionID = SessionID.make("session_queue_cancel_idle")
          const events: Array<{ queued: string[] }> = []
          const off = Bus.subscribe(KiloSession.Event.QueueChanged, (event) => {
            if (event.properties.sessionID === sessionID) {
              events.push({ queued: [...(event.properties.queued as readonly string[])] })
            }
          })

          try {
            await Effect.runPromise(KiloSessionPromptQueue.cancel(sessionID))
            expect(KiloSessionPromptQueue.snapshot(sessionID)).toEqual([])
            expect(events).toEqual([])
          } finally {
            off()
          }
        },
      })
    })
  })
  // kilocode_change end
})
