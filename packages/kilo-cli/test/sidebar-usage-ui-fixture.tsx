import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Cause, Effect, Exit, Fiber } from "effect"
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { launch } from "../src/interactive-server"
import type { Layout } from "../src/paths"
import { guardedFixtureLayout } from "./fixture"
import { Session } from "@opencode-ai/schema/session"
import { SessionUsageRpc } from "../src/session-usage-rpc"
import { runTui } from "../src/tui"

let requests = 0
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/chat/completions") return new Response(null, { status: 404 })
    requests++
    const body = (await request.json()) as { stream?: boolean }
    const response = {
      id: "usage-fixture",
      created: 1,
      model: "chat",
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }
    if (!body.stream)
      return Response.json({
        ...response,
        object: "chat.completion",
        choices: [
          { index: 0, message: { role: "assistant", content: "Usage fixture response" }, finish_reason: "stop" },
        ],
      })
    const frames = [
      {
        ...response,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", content: "Usage fixture response" }, finish_reason: null }],
      },
      {
        ...response,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
    ]
    return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    })
  },
})

const setup = await createTestRenderer({ width: 160, height: 40, useThread: false, kittyKeyboard: true })
setup.renderer.start()
const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
const terminalHandoff = async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve })

const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const input = guardedFixtureLayout()
      yield* Effect.promise(async () => {
        await mkdir(path.dirname(input.config), { recursive: true })
        await Bun.write(input.config, '{ "privacy_mode": true }\n')
      })
      const sourceDirectory = path.join(process.cwd(), "usage-source")
      yield* Effect.promise(() => mkdir(sourceDirectory, { recursive: true }))
      const childData = yield* Effect.scoped(
        Effect.gen(function* () {
          const source = yield* launch(
            interactiveLayout(path.join(process.cwd(), "usage-source-host"), input.paths.home),
            {
              models: false,
              recover: false,
              content: modelConfig(),
            },
          )
          const sourceClient = createClient({
            baseUrl: source.url,
            headers: Object.fromEntries(new Headers(Service.headers(source))),
          })
          const sourceLocation = { directory: sourceDirectory }
          yield* Effect.promise(() => sourceClient.plugin.awaitActivation({ location: sourceLocation }))
          const sourceSession = yield* Effect.promise(() =>
            sourceClient.session.create({ location: sourceLocation, model: { providerID: "fixture", id: "child" } }),
          )
          yield* Effect.promise(() =>
            sourceClient.session.prompt({ sessionID: sourceSession.id, text: "Count the child" }),
          )
          yield* Effect.promise(() =>
            sourceClient.session.wait({ sessionID: sourceSession.id }, { signal: AbortSignal.timeout(10000) }),
          )
          return yield* Effect.promise(() => sourceClient.session.export({ sessionID: sourceSession.id }))
        }),
      )
      const endpoint = yield* launch(input, {
        models: false,
        recover: false,
        content: modelConfig(),
      })
      const client = createClient({
        baseUrl: endpoint.url,
        headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
      })
      const location = { directory: process.cwd() }
      yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
      const root = yield* Effect.promise(() =>
        client.session.create({
          title: "Session usage fixture",
          location,
          model: { providerID: "fixture", id: "chat" },
        }),
      )
      yield* Effect.promise(() => client.session.prompt({ sessionID: root.id, text: "Count the root" }))
      yield* Effect.promise(() => client.session.wait({ sessionID: root.id }, { signal: AbortSignal.timeout(10000) }))
      const rpc = client.rpc(SessionUsageRpc)
      const child = yield* Effect.promise(() =>
        client.session.import({ ...childData, info: { ...childData.info, parentID: root.id }, location }),
      )
      const initial = yield* Effect.promise(() => rpc.get({ sessionID: root.id }, { location }))
      assert(initial.sessionIDs.includes(Session.ID.make(child.id)))
      assert.equal(initial.totals.steps, 2)
      assert.equal(initial.models.length, 2)

      const tui = runTui(input, endpoint, { args: { sessionID: root.id }, terminalHandoff })
      const fiber = yield* Effect.forkScoped(tui.pipe(Effect.ensuring(Effect.sync(closed.resolve))))
      yield* Effect.tryPromise(async () => {
        await Promise.race([
          ready.promise,
          new Promise<never>((_, reject) => {
            AbortSignal.timeout(15_000).addEventListener(
              "abort",
              () => reject(new Error("TUI handoff timed out\n" + setup.captureCharFrame())),
              { once: true },
            )
          }),
          closed.promise.then(async () => {
            await Effect.runPromise(Fiber.join(fiber))
            throw new Error("TUI closed before terminal handoff")
          }),
        ])
        await setup.waitForFrame(
          (frame) =>
            frame.includes("Session family usage") &&
            new RegExp(`Input\\s+${initial.totals.tokens.input}`).test(frame) &&
            frame.includes("•••") &&
            !frame.includes("fixture/chat") &&
            (frame.match(/steps/g)?.length ?? 0) === initial.models.length,
          { maxPasses: 600 },
        )
        const beforeInteraction = requests
        assert(beforeInteraction > 0)

        await client.session.prompt(
          { sessionID: root.id, text: "Refresh the root" },
          { signal: AbortSignal.timeout(10_000) },
        )
        await client.session.wait({ sessionID: root.id }, { signal: AbortSignal.timeout(10000) })
        assert.equal((await client.session.get({ sessionID: root.id })).parentID, undefined)
        const refreshed = await rpc.get({ sessionID: root.id }, { location })
        assert.equal(refreshed.totals.steps, initial.totals.steps + 1)
        await setup.waitForFrame(
          (frame) =>
            new RegExp(`Input\\s+${refreshed.totals.tokens.input}`).test(frame) &&
            frame.includes(`${refreshed.models.find((model) => model.modelID === "chat")?.steps} steps`),
          { maxPasses: 600 },
        )
        assert(requests > beforeInteraction)

        // Per-model rows expand locally: clicking one reveals that model's
        // token breakdown without any new usage request, and clicking it
        // again collapses the block. The sidebar runs with privacy on, so
        // identifiers and costs stay masked while the expanded counts render.
        const expandModelRow = async (steps: number) => {
          const lines = setup.captureCharFrame().split("\n")
          const row = lines.findIndex((line) => line.includes(`${steps} steps ·`))
          assert(row >= 0, `a per-model row with ${steps} steps is rendered`)
          await setup.mockMouse.click(lines[row]!.indexOf("steps"), row)
        }
        const chat = refreshed.models.find((model) => model.modelID === "chat")
        const other = refreshed.models.find((model) => model.modelID !== "chat")
        assert(chat && other, "both model rows exist in the aggregate")
        assert.notEqual(chat.steps, other.steps, "model rows are distinguishable by their step counts")
        const beforeExpand = requests
        await expandModelRow(chat.steps)
        const expanded = await setup.waitForFrame(
          (frame) =>
            (frame.match(/Cache rate/g) ?? []).length === 2 &&
            frame.includes("▼ •••") &&
            frame.includes("▶ •••") &&
            new RegExp(`Input\\s+${chat.tokens.input}\\b`).test(frame) &&
            new RegExp(`Output\\s+${chat.tokens.output}\\b`).test(frame),
          { maxPasses: 600 },
        )
        assert(expanded.includes("•••"), "masked identifiers stay masked while expanded")
        assert.equal(requests, beforeExpand, "expanding a model row makes no usage request")
        await expandModelRow(chat.steps)
        await setup.waitForFrame(
          (frame) =>
            (frame.match(/Cache rate/g) ?? []).length === 1 &&
            !frame.includes("▼ •••") &&
            !new RegExp(`Input\\s+${chat.tokens.input}\\b`).test(frame),
          { maxPasses: 600 },
        )
        assert.equal(requests, beforeExpand)

        const beforeResize = requests
        setup.resize(100, 45)
        await setup.waitForFrame((frame) => !frame.includes("Session family usage"), { maxPasses: 600 })
        setup.resize(140, 45)
        await setup.waitForFrame(
          (frame) =>
            frame.includes("Session family usage") &&
            new RegExp(`Input\\s+${refreshed.totals.tokens.input}`).test(frame),
          { maxPasses: 600 },
        )
        assert.equal(requests, beforeResize)
      })
      yield* Effect.promise(async () => {
        // Sidebar clicks move focus away from the composer; refocus before typing a command.
        const composer = setup
          .captureCharFrame()
          .split("\n")
          .findIndex((line) => line.includes("Code · chat fixture"))
        assert(composer >= 2, "composer is visible after sidebar clicks")
        await setup.mockMouse.click(5, composer - 2)
        await setup.mockInput.typeText("/exit")
        setup.mockInput.pressEnter()
        await closed.promise
      })
      yield* Fiber.join(fiber)
    }).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit)) console.error(Cause.pretty(exit.cause))
        }),
      ),
    ),
  ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
)

try {
  await task
  console.log("TUI_SIDEBAR_USAGE_FIXTURE_OK")
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  await gateway.stop(true)
}

function modelConfig() {
  return JSON.stringify({
    model: "fixture/chat",
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: gateway.url.origin },
        models: {
          chat: { cost: { input: 1, output: 2, cache: { read: 0.1, write: 0 } } },
          child: { cost: { input: 1, output: 2, cache: { read: 0.1, write: 0 } } },
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
