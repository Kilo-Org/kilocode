import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Cause, Effect, Exit, Fiber } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { dial } from "../src/network-policy"
import { runTui } from "../src/tui"
import { guardedFixtureLayout } from "./fixture"

// The provider port is reserved, then closed so the first request is refused like a dead network.
const reserved = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) })
const port = reserved.port!
await reserved.stop(true)
let provider: ReturnType<typeof Bun.serve> | undefined
const startProvider = () => {
  provider ??= Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const frame = (delta: Record<string, unknown>, finish: string | null) =>
        `data: ${JSON.stringify({ id: "network-ui", object: "chat.completion.chunk", model: "chat", created: 1, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      return new Response(
        frame({ role: "assistant", content: "Reconnected fixture reply" }, null) + frame({}, "stop") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
}

const setup = await createTestRenderer({ width: 140, height: 40, useThread: false, kittyKeyboard: true })
setup.renderer.start()
const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
const terminalHandoff = async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve })

const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const input = guardedFixtureLayout()
      const endpoint = yield* launch(input, {
        models: false,
        recover: false,
        // A long countdown proves Enter resumes early; loopback-only probing never reaches the internet.
        network: { probe: (target) => (target ? dial(target) : Promise.resolve(false)), pollMs: 50, resumeMs: 60_000 },
        content: JSON.stringify({
          model: "fixture/chat",
          providers: {
            fixture: {
              package: "aisdk:@ai-sdk/openai-compatible",
              settings: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "fixture" },
              models: { chat: {} },
            },
          },
        }),
      })
      const client = createClient({
        baseUrl: endpoint.url,
        headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
      })
      const location = { directory: process.cwd() }
      yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
      const session = yield* Effect.promise(() =>
        client.session.create({ title: "Network fixture", location, model: { providerID: "fixture", id: "chat" } }),
      )

      const tui = runTui(input, endpoint, { args: { sessionID: session.id }, terminalHandoff })
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

        await client.session.prompt({ sessionID: session.id, text: "Reach the provider" })
        await setup.waitForFrame(
          (frame) =>
            frame.includes("Network disconnected") &&
            frame.includes("Connection refused") &&
            frame.includes("Waiting for network"),
          { maxPasses: 600 },
        )

        startProvider()
        await setup.waitForFrame(
          // The panel counts down from the host deadline, not a client-side default.
          (frame) => frame.includes("Network reconnected") && /Retrying in (60|59)s\./.test(frame),
          { maxPasses: 600 },
        )
        setup.mockInput.pressEnter()
        await setup.waitForFrame(
          (frame) => frame.includes("Reconnected fixture reply") && !frame.includes("Network reconnected"),
          { maxPasses: 600 },
        )
        await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })

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
  console.log("TUI_NETWORK_FIXTURE_OK")
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  await provider?.stop(true)
}
