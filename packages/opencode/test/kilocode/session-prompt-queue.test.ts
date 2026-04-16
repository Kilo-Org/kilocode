import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
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

describe("session prompt queue", () => {
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
})
