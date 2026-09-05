import { expect, test } from "bun:test"
import { createClient } from "@kilocode/client"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { launch } from "../src/interactive-server"
import type { Layout } from "../src/paths"
import { SessionUsageRpc } from "../src/session-usage-rpc"
import { fixture } from "./fixture"

test("session usage reads only the current location's durable parent family", async () => {
  await using input = await fixture()
  const model = usageModel()
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sourceDirectory = path.join(input.directory, "source-project")
          const otherDirectory = path.join(input.directory, "other-project")
          yield* Effect.promise(() =>
            Promise.all([mkdir(sourceDirectory, { recursive: true }), mkdir(otherDirectory, { recursive: true })]),
          )
          const source = yield* launch(interactiveLayout(path.join(input.directory, "source"), input.home), {
            content: modelConfig(model.url.origin),
            recover: false,
            models: false,
          })
          const sourceClient = createClient({
            baseUrl: source.url,
            headers: { authorization: `Basic ${btoa(`opencode:${source.auth.password}`)}` },
          })
          const sourceLocation = { directory: sourceDirectory }
          const childData = yield* Effect.promise(() => completed(sourceClient, sourceLocation, "child"))
          const foreignData = yield* Effect.promise(() => completed(sourceClient, sourceLocation, "foreign"))
          const siblingData = yield* Effect.promise(() => completed(sourceClient, sourceLocation, "sibling"))

          const server = yield* launch(interactiveLayout(path.join(input.directory, "destination"), input.home), {
            content: modelConfig(model.url.origin),
            recover: false,
            models: false,
          })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { directory: input.cwd }
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          const root = yield* Effect.promise(() =>
            client.session.create({ location, model: { providerID: "fixture", id: "chat" } }),
          )
          yield* Effect.promise(() => client.session.prompt({ sessionID: root.id, text: "Root usage" }))
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: root.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          const child = yield* Effect.promise(() =>
            client.session.import({ ...childData, info: { ...childData.info, parentID: root.id }, location }),
          )
          const foreign = yield* Effect.promise(() =>
            client.session.import({
              ...foreignData,
              info: { ...foreignData.info, parentID: root.id },
              location: { directory: otherDirectory },
            }),
          )
          const sibling = yield* Effect.promise(() => client.session.import({ ...siblingData, location }))

          const usage = yield* Effect.promise(() =>
            client.rpc(SessionUsageRpc).get({ sessionID: child.id }, { location }),
          )
          expect(usage.sessionIDs.map(String).sort()).toEqual([root.id, child.id].map(String).sort())
          expect(usage.totals).toMatchObject({
            steps: 2,
            tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 4, write: 0 } },
          })
          expect(usage.models).toEqual([
            expect.objectContaining({ providerID: "fixture", modelID: "chat", steps: 1 }),
            expect.objectContaining({ providerID: "fixture", modelID: "child", steps: 1 }),
          ])
          expect(Number(usage.totals.cost)).toBeCloseTo(0.0000224, 10)
          expect(usage.sessionIDs.map(String)).not.toContain(String(foreign.id))
          expect(usage.sessionIDs.map(String)).not.toContain(String(sibling.id))

          yield* Effect.promise(async () => {
            await expect(client.rpc(SessionUsageRpc).get({ sessionID: foreign.id }, { location })).rejects.toThrow(
              "Session is unavailable",
            )
          })
        }),
      ),
    )
  } finally {
    model.stop(true)
  }
}, 30_000)

test("session usage omits an in-flight assistant until its step settles", async () => {
  await using input = await fixture()
  const model = heldUsageModel()
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(interactiveLayout(path.join(input.directory, "held"), input.home), {
            content: modelConfig(model.url.origin),
            recover: false,
            models: false,
          })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { directory: input.cwd }
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          const session = yield* Effect.promise(() =>
            client.session.create({ location, model: { providerID: "fixture", id: "chat" } }),
          )
          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: "held usage" }))
          yield* Effect.promise(() => model.started)

          const during = yield* Effect.promise(() =>
            client.rpc(SessionUsageRpc).get({ sessionID: session.id }, { location }),
          )
          expect(during.totals.steps).toBe(0)
          expect(during.models).toEqual([])

          model.release()
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          const settled = yield* Effect.promise(() =>
            client.rpc(SessionUsageRpc).get({ sessionID: session.id }, { location }),
          )
          expect(settled.totals.steps).toBe(1)
          expect(settled.models).toEqual([
            expect.objectContaining({ providerID: "fixture", modelID: "chat", steps: 1 }),
          ])
        }),
      ),
    )
  } finally {
    model.stop(true)
  }
}, 30_000)

async function completed(
  client: ReturnType<typeof createClient>,
  location: { readonly directory: string },
  model: string,
) {
  const session = await client.session.create({ location, model: { providerID: "fixture", id: model } })
  await client.session.prompt({ sessionID: session.id, text: `${model} usage` })
  await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
  return client.session.export({ sessionID: session.id })
}

function usageModel() {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body: { stream?: boolean } = await request.json()
      if (!body.stream)
        return Response.json({ choices: [{ message: { role: "assistant", content: "usage fixture" } }] })
      return new Response(
        [
          { choices: [{ delta: { role: "assistant", content: "usage fixture" }, finish_reason: null }] },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 7,
              completion_tokens: 3,
              total_tokens: 10,
              prompt_tokens_details: { cached_tokens: 2 },
              completion_tokens_details: { reasoning_tokens: 1 },
            },
          },
        ]
          .map(
            (frame) =>
              `data: ${JSON.stringify({ id: "usage-fixture", object: "chat.completion.chunk", ...frame })}\n\n`,
          )
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
}

function heldUsageModel() {
  let startedResolve: (() => void) | undefined
  const started = new Promise<void>((done) => {
    startedResolve = done
  })
  let release!: () => void
  const released = new Promise<void>((done) => {
    release = done
  })
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      startedResolve?.()
      await released
      return new Response(
        [
          { choices: [{ delta: { role: "assistant", content: "usage fixture" }, finish_reason: null }] },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
          },
        ]
          .map(
            (frame) => `data: ${JSON.stringify({ id: "usage-held", object: "chat.completion.chunk", ...frame })}\n\n`,
          )
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  return { url: server.url, started, release, stop: (close: boolean) => server.stop(close) }
}

function modelConfig(baseURL: string) {
  return JSON.stringify({
    model: "fixture/chat",
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: `${baseURL}/v1`, apiKey: "fixture" },
        models: {
          chat: { cost: { input: 1, output: 2, cache: { read: 0.1, write: 0 } } },
          child: { cost: { input: 1, output: 2, cache: { read: 0.1, write: 0 } } },
          foreign: { cost: { input: 1, output: 2, cache: { read: 0.1, write: 0 } } },
          sibling: { cost: { input: 1, output: 2, cache: { read: 0.1, write: 0 } } },
        },
      },
    },
  })
}

function interactiveLayout(root: string, home: string): Layout {
  const paths = {
    home,
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive",
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}
