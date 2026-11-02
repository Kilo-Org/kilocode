import { afterAll, expect, test } from "bun:test"
import { $ } from "bun"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { Generate } from "@opencode/core/generate"
import { KiloCommitMessageRpc } from "@opencode/schema/kilocode/commit-message"
import { createRoutes } from "@opencode/server/routes"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// The kilocode.commit-message RPC through the real host and the generated client. A stand-in Generate service
// records the request and answers, so the test needs no model; the Kilo API is a local stand-in too.
type Answer = { text: string } | { error: string }
const calls: Generate.TextInput[] = []
const state: { answer: Answer } = { answer: { text: "feat: add note" } }

const generate = makeLocationNode({
  service: Generate.Service,
  layer: Layer.succeed(
    Generate.Service,
    Generate.Service.of({
      text: (input) => {
        calls.push(input)
        const answer = state.answer
        return "error" in answer
          ? Effect.fail(new Generate.UnavailableError({ message: answer.error }))
          : Effect.succeed(answer.text)
      },
      image: () => Effect.die("unused"),
      decisions: () => Effect.die("unused"),
    }),
  ),
  deps: [],
})

const boot =
  (
    config: Record<string, unknown>,
    body: (input: { directory: string; rpc: Rpc }) => Promise<void>,
    options: { model?: "stub" | "real" } = {},
  ) =>
  async () => {
    using backend = fixture()
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-commit-message-rpc-")))
    const directory = path.join(root, "repo")
    await $`git init -q -b main ${directory}`.quiet()
    await $`git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q --allow-empty -m init`
      .cwd(directory)
      .quiet()
    await Bun.write(path.join(directory, "kilo2.json"), JSON.stringify(config))
    await $`git add kilo2.json`.cwd(directory).quiet()
    await $`git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m config`.cwd(directory).quiet()
    const previous = { KILO_API_URL: process.env.KILO_API_URL, KILO_API_KEY: process.env.KILO_API_KEY }
    process.env.KILO_API_URL = backend.url
    delete process.env.KILO_API_KEY
    calls.length = 0
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(
              createRoutes(
                {
                  password: "secret",
                  database: { path: ":memory:" },
                  models: { fetch: false },
                  fs: { filewatcher: false },
                  config: { directory: path.join(root, "global"), project: true },
                },
                () => [],
                options.model === "real" ? KiloHost.overrides : [...KiloHost.overrides, Generate.node.replace(generate)],
              ).pipe(Layer.provide(HttpServer.layerServices)),
            )
            const handler = Context.get(context, HttpRouter.HttpRouter)
              .asHttpEffect()
              .pipe(HttpEffect.toWebHandlerWith(context))
            const client = OpenCode.make({
              baseUrl: "http://kilo.local",
              headers: { authorization: `Basic ${btoa("opencode:secret")}` },
              fetch: Object.assign(
                async (input: string | URL | Request, init?: RequestInit) =>
                  handler(input instanceof Request ? input : new Request(input, init)),
                { preconnect: fetch.preconnect },
              ),
            })
            const methods = client.rpc(KiloCommitMessageRpc.Definition)
            yield* Effect.promise(() =>
              body({
                directory,
                rpc: { generate: (input) => methods.generate(input, { location: { directory } }) },
              }),
            )
          }),
        ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
      )
    } finally {
      Object.entries(previous).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      await rm(root, { recursive: true, force: true })
    }
  }

type Rpc = { generate: (input: KiloCommitMessageRpc.Input) => Promise<{ message: string }> }

const provider = {
  test: {
    npm: "@ai-sdk/openai-compatible",
    options: { baseURL: "http://127.0.0.1:9/v1", apiKey: "test-key" },
    models: { large: { name: "Large" }, small: { name: "Small" } },
  },
}

test(
  "a clean repository fails with no_changes and the real message, without a model call",
  boot({}, async ({ directory, rpc }) => {
    await expect(rpc.generate({ path: directory })).rejects.toEqual({
      type: "no_changes",
      message: "No changes found to generate a commit message for",
    })
    expect(calls).toEqual([])
  }),
  30_000,
)

test(
  "a model failure fails with the real message",
  boot({}, async ({ directory, rpc }) => {
    await Bun.write(path.join(directory, "note.txt"), "hello")
    state.answer = { error: "request exceeds the available context size (4096 tokens)" }
    await expect(rpc.generate({ path: directory })).rejects.toEqual({
      type: "failed",
      message: "Failed to generate commit message: request exceeds the available context size (4096 tokens)",
    })
  }),
  30_000,
)

test(
  "the staged change, the configured prompt, the language and the small model reach the model",
  boot(
    {
      commit_message: { prompt: "Write a haiku commit message." },
      model: "test/large",
      small_model: "test/small",
      enabled_providers: ["test"],
      provider,
    },
    async ({ directory, rpc }) => {
      await Bun.write(path.join(directory, "note.txt"), "hello")
      await $`git add note.txt`.cwd(directory).quiet()
      await Bun.write(path.join(directory, "untracked.txt"), "not staged")
      state.answer = { text: '```\n"docs: add note"\n```' }

      expect(await rpc.generate({ path: directory, language: "de", previousMessage: "docs: old" })).toEqual({
        message: "docs: add note",
      })
      expect(calls).toHaveLength(1)
      expect(calls[0]!.model).toMatchObject({ providerID: "test", id: "small" })
      const prompt = calls[0]!.prompt
      expect(prompt.startsWith("Write a haiku commit message.")).toBe(true)
      expect(prompt).toContain("following language: de")
      expect(prompt).toContain('The previous message was: "docs: old"')
      expect(prompt).toContain("Changed files:\nadded note.txt\n")
      expect(prompt).not.toContain("untracked.txt")
    },
  ),
  30_000,
)

// A local OpenAI-compatible model server, as llama.cpp or Ollama expose it. It records the requested model and answers
// with the next queued reply: text, or an error event inside the stream.
const local = (() => {
  const state = { reply: { text: "" } as { text: string } | { error: string }, models: [] as string[] }
  const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { model: string; stream?: boolean }
      state.models.push(body.model)
      const reply = state.reply
      if ("error" in reply) {
        const error = { code: "context_length_exceeded", message: reply.error, type: "exceed_context_size_error" }
        return new Response(chunk({ error }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
      }
      const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: body.model }
      return new Response(
        chunk({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: reply.text } }] }) +
          chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
          "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  return { state, url: `${server.url.origin}/v1`, stop: () => server.stop(true) }
})()

const localConfig = (extra: Record<string, unknown> = {}) => ({
  model: "local/large",
  enabled_providers: ["local"],
  provider: {
    local: {
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: local.url, apiKey: "local-key" },
      models: { large: { name: "Large", limit: { context: 4096, output: 1024 } } },
    },
  },
  ...extra,
})

test(
  "a local model without a small model generates the message with the default model",
  boot(
    localConfig(),
    async ({ directory, rpc }) => {
      await Bun.write(path.join(directory, "note.txt"), "hello")
      local.state.models.length = 0
      local.state.reply = { text: "```\nfeat: add note\n```" }
      expect(await rpc.generate({ path: directory })).toEqual({ message: "feat: add note" })
      expect(local.state.models).toEqual(["large"])
    },
    { model: "real" },
  ),
  30_000,
)

test(
  "an unavailable small_model falls back to the default model",
  boot(
    localConfig({ small_model: "missing/model" }),
    async ({ directory, rpc }) => {
      await Bun.write(path.join(directory, "note.txt"), "hello")
      local.state.models.length = 0
      local.state.reply = { text: "feat: add note" }
      expect(await rpc.generate({ path: directory })).toEqual({ message: "feat: add note" })
      expect(local.state.models).toEqual(["large"])
    },
    { model: "real" },
  ),
  30_000,
)

test(
  "a streamed provider error from a local model keeps its message",
  boot(
    localConfig(),
    async ({ directory, rpc }) => {
      await Bun.write(path.join(directory, "note.txt"), "hello")
      local.state.reply = { error: "request exceeds the available context size (4096 tokens)" }
      await expect(rpc.generate({ path: directory })).rejects.toEqual({
        type: "failed",
        message: "Failed to generate commit message: request exceeds the available context size (4096 tokens)",
      })
    },
    { model: "real" },
  ),
  30_000,
)

afterAll(() => local.stop())
