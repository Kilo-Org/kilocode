import path from "path"
import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import { Cause, Effect, Exit } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { makeRuntime } from "@/effect/run-service"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import {
  provideTestInstance,
  disposeTestRuntime,
  provideInstance,
  testInstanceStoreLayer,
  tmpdir,
} from "../../fixture/fixture"
import { remove as cleanup } from "../cleanup"
import { awaitWithTimeout } from "../../lib/effect"

const previous = Flag.KILO_DB
const dbfile = path.join(os.tmpdir(), `kilo-named-agent-${process.pid}-${crypto.randomUUID()}.db`)
const both = LayerNode.compile(LayerNode.group([Session.node, SessionPrompt.node, SessionProjector.node]))

beforeAll(async () => {
  await fs.rm(dbfile, { force: true })
  Flag.KILO_DB = dbfile
})

afterAll(async () => {
  await disposeTestRuntime()
  Flag.KILO_DB = previous
  await Promise.all([dbfile, `${dbfile}-wal`, `${dbfile}-shm`].map(cleanup))
})

function line(input: unknown) {
  return `data: ${JSON.stringify(input)}\n\n`
}

function chat(input: { delta?: Record<string, unknown>; finish?: string }) {
  return {
    id: "chatcmpl-named-agent-test",
    object: "chat.completion.chunk",
    choices: [{ delta: input.delta ?? {}, ...(input.finish ? { finish_reason: input.finish } : {}) }],
  }
}

function text(value: string) {
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(
        new TextEncoder().encode(
          [
            line(chat({ delta: { role: "assistant" } })),
            line(chat({ delta: { content: value } })),
            line(chat({ finish: "stop" })),
            "data: [DONE]\n\n",
          ].join(""),
        ),
      )
      ctrl.close()
    },
  })
}

function task(args: { description: string; prompt: string; subagent_type: string }) {
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(
        new TextEncoder().encode(
          [
            line(
              chat({
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-task",
                      type: "function",
                      function: { name: "task", arguments: JSON.stringify(args) },
                    },
                  ],
                },
              }),
            ),
            line(chat({ finish: "tool_calls" })),
            "data: [DONE]\n\n",
          ].join(""),
        ),
      )
      ctrl.close()
    },
  })
}

function scoped<T, E>(
  dir: string,
  fn: (input: { prompt: SessionPrompt.Interface; sessions: Session.Interface }) => Effect.Effect<T, E>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      return yield* fn({ prompt, sessions })
    }).pipe(Effect.provide(both), provideInstance(dir), Effect.provide(testInstanceStoreLayer), Effect.scoped),
  )
}

test(
  "an agent part in the prompt names the subagent and skips its task permission ask",
  async () => {
    const bodies: string[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (!new URL(req.url).pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
        const body = await req.text()
        bodies.push(body)
        // First request is the parent turn; the child then runs one turn of its own.
        return new Response(bodies.length === 1 ? task({ description: "Explore", prompt: "list files", subagent_type: "explore" }) : text("child finished"), {
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
              permission: { task: "ask" },
            }),
          ),
      })
      await provideTestInstance({
        directory: tmp.path,
        fn: () =>
          scoped(tmp.path, ({ prompt, sessions }) =>
            Effect.gen(function* () {
              const session = yield* sessions.create({ title: "Agent part names its subagent" })
              const exit = yield* awaitWithTimeout(
                Effect.exit(
                  prompt.prompt({
                    sessionID: session.id,
                    agent: "code",
                    parts: [
                      { type: "agent", name: "explore" },
                      { type: "text", text: "explore the repository" },
                    ],
                  }),
                ),
                "the task tool waited for a permission ask instead of using the agent part",
                "25 seconds",
              )
              if (Exit.isFailure(exit)) throw new Error("prompt failed: " + Cause.pretty(exit.cause))
              const children = yield* sessions.children(session.id)
              expect(children.map((child) => child.agent)).toEqual(["explore"])
            }),
          ),
      })
    } finally {
      await server.stop(true)
    }
  },
  60_000,
)
