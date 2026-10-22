import path from "path"
import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { AppRuntime } from "../../src/effect/app-runtime"
import { makeRuntime } from "../../src/effect/run-service"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionID } from "../../src/session/schema"
import {
  provideTestInstance,
  disposeTestRuntime,
  provideInstance,
  testInstanceStoreLayer,
  tmpdir,
} from "../fixture/fixture"
import { remove as cleanup } from "./cleanup"

const previous = Flag.KILO_DB
const dbfile = path.join(os.tmpdir(), `kilo-prompt-steering-${process.pid}-${crypto.randomUUID()}.db`)
const layer = LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node]))
const prompt = LayerNode.compile(LayerNode.group([SessionPrompt.node, SessionProjector.node]))
const runtime = makeRuntime(Session.Service, layer)

beforeAll(async () => {
  await fs.rm(dbfile, { force: true })
  Flag.KILO_DB = dbfile
})

afterAll(async () => {
  await runtime.dispose()
  await AppRuntime.dispose()
  await disposeTestRuntime()
  Flag.KILO_DB = previous
  await Promise.all([dbfile, `${dbfile}-wal`, `${dbfile}-shm`].map(cleanup))
})

function line(input: unknown) {
  return `data: ${JSON.stringify(input)}\n\n`
}

function chunk(input: { delta?: Record<string, unknown>; finish?: string }) {
  return {
    id: "chatcmpl-steering-test",
    object: "chat.completion.chunk",
    choices: [{ delta: input.delta ?? {}, ...(input.finish ? { finish_reason: input.finish } : {}) }],
  }
}

function response(input: string) {
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(
        new TextEncoder().encode(
          [
            line(chunk({ delta: { role: "assistant" } })),
            line(chunk({ delta: { content: input } })),
            line(chunk({ finish: "stop" })),
            "data: [DONE]\n\n",
          ].join(""),
        ),
      )
      ctrl.close()
    },
  })
}

function question() {
  const args = JSON.stringify({
    questions: [
      {
        header: "Redirect",
        question: "Continue the old task?",
        options: [{ label: "Yes", description: "Continue" }],
      },
    ],
  })
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(
        new TextEncoder().encode(
          [
            line(
              chunk({
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-question",
                      type: "function",
                      function: { name: "question", arguments: args },
                    },
                  ],
                },
              }),
            ),
            line(chunk({ finish: "tool_calls" })),
            "data: [DONE]\n\n",
          ].join(""),
        ),
      )
      ctrl.close()
    },
  })
}

const sessions = {
  create: (input: Parameters<Session.Interface["create"]>[0]) =>
    runtime.runPromise((svc) => svc.create(input)),
  messages: (sessionID: SessionID) =>
    runtime.runPromise((svc) => svc.messages({ sessionID })),
}

async function wait(sessionID: SessionID) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const msgs = await sessions.messages(sessionID)
    if (
      msgs.some((msg) =>
        msg.parts.some((part) => part.type === "tool" && part.tool === "question" && part.state.status === "running"),
      )
    )
      return
    await Bun.sleep(20)
  }
  throw new Error("question tool did not become pending")
}

function scoped<T>(dir: string, fn: (prompt: SessionPrompt.Interface) => Promise<T>) {
  return Effect.runPromise(
    SessionPrompt.Service.use((prompt) => Effect.promise(() => fn(prompt))).pipe(
      Effect.provide(prompt),
      provideInstance(dir),
      Effect.provide(testInstanceStoreLayer),
      Effect.scoped,
    ),
  )
}

function tail(body: Record<string, unknown>): { role: string; content: unknown } | undefined {
  const msgs = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : []
  const item = msgs.findLast((msg) => msg.role !== "system")
  if (!item || typeof item.role !== "string") return
  return { role: item.role, content: item.content }
}

test("runs queued steering before resuming a dismissed question turn", async () => {
  const calls: Array<Record<string, unknown>> = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (!new URL(req.url).pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
      calls.push((await req.json()) as Record<string, unknown>)
      return new Response(calls.length === 1 ? question() : response("steering acknowledged"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    },
  })

  try {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) =>
        Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            enabled_providers: ["alibaba"],
            provider: { alibaba: { options: { apiKey: "test-key", baseURL: `${server.url.origin}/v1` } } },
            agent: { code: { model: "alibaba/qwen-plus" } },
          }),
        ),
    })
    await provideTestInstance({
      directory: tmp.path,
      fn: () =>
        scoped(tmp.path, async (prompt) => {
          const session = await sessions.create({ title: "Queued steering regression" })
          const first = Effect.runPromise(
            prompt.prompt({
              sessionID: session.id,
              agent: "code",
              parts: [{ type: "text", text: "perform the old task" }],
            }),
          )
          await wait(session.id)
          const second = Effect.runPromise(
            prompt.prompt({
              sessionID: session.id,
              agent: "code",
              parts: [{ type: "text", text: "stop the old task and inspect the failing test" }],
            }),
          )
          await first
          const result = await second
          expect(result.parts.some((part) => part.type === "text" && part.text.includes("steering acknowledged"))).toBe(
            true,
          )
          expect(calls).toHaveLength(2)
          expect(tail(calls[1]!)?.role).toBe("user")
          expect(JSON.stringify(tail(calls[1]!)?.content)).toContain("stop the old task and inspect the failing test")
          expect(JSON.stringify(tail(calls[1]!)?.content)).not.toContain("<system-reminder>")
        }),
    })
  } finally {
    server.stop(true)
  }
}, 60_000)
