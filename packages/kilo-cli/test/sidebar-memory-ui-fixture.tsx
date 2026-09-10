import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { KiloMemory } from "@kilocode/kilo-memory/effect"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { guardedFixtureLayout } from "./fixture"
import { MemoryRpc } from "../src/memory-rpc"
import { runTui } from "../src/tui"

const input = guardedFixtureLayout()
const injectedSession = Promise.withResolvers<string>()
const setup = await createTestRenderer({ width: 160, height: 40, useThread: false, kittyKeyboard: true })
setup.renderer.start()

const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
const terminalHandoff = async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve })

// Loopback model: primary turns and the auxiliary typed consolidation are real
// host requests; the typed step returns one accepted operation so the capture
// path publishes a real per-session saved event. No live or paid inference.
const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
    const body: { messages?: Array<{ content?: string }> } = await request.json()
    const contents = JSON.stringify(body.messages)
    const content = contents.includes("typed memory consolidation step")
      ? JSON.stringify({
          operations: [{ op: "upsert_project_fact", key: "sidebar_pulse_note", value: "sidebar pulse fixture" }],
          skipped: [],
        })
      : "Primary fixture response"
    return new Response(
      [
        {
          id: "memory-sidebar-pulse",
          object: "chat.completion.chunk",
          created: 1,
          model: "chat",
          choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
        },
        {
          id: "memory-sidebar-pulse",
          object: "chat.completion.chunk",
          created: 1,
          model: "chat",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      ]
        .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
        .join("") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    )
  },
})

const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const endpoint = yield* launch(input, {
        models: false,
        recover: false,
        content: JSON.stringify({
          snapshots: true,
          model: "fixture/chat",
          providers: {
            fixture: {
              package: "aisdk:@ai-sdk/openai-compatible",
              settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
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
      const rpc = client.rpc(MemoryRpc.Definition)
      const session = yield* Effect.promise(() =>
        client.session.create({
          title: "Memory sidebar fixture",
          location,
          model: { providerID: "fixture", id: "chat" },
        }),
      )
      const tui = runTui(input, endpoint, { args: { sessionID: session.id }, terminalHandoff })
      const fiber = yield* Effect.forkScoped(tui.pipe(Effect.ensuring(Effect.sync(closed.resolve))))
      const mutedBullet = yield* Effect.tryPromise(async () => {
        await Promise.race([
          ready.promise,
          closed.promise.then(async () => {
            await Effect.runPromise(Fiber.join(fiber))
            throw new Error("TUI closed before terminal handoff")
          }),
        ])
        await setup.waitForFrame((frame) => frame.includes("Memory sidebar fixture") && frame.includes("• Disabled"), {
          maxPasses: 600,
        })

        const initial = setup.captureCharFrame()
        assert(!initial.includes("project.md"))
        assert(!initial.includes("environment.md"))
        assert(!initial.includes("corrections.md"))
        assert(!initial.includes("index.kmem"))

        await command("/memory enable", "Memory enabled.")
        await setup.waitForFrame((frame) => frame.includes("• Enabled") && !frame.includes("• Disabled"), {
          maxPasses: 600,
        })

        // The sidebar is the compact current-main status row only; details stay
        // in the memory dialog and RPC.
        const enabled = setup.captureCharFrame()
        assert(!enabled.includes("Auto:"))
        assert(!enabled.includes("Data:"))
        assert(!enabled.includes("Injected:"))
        assert(!enabled.includes("Last save"))
        assert(!enabled.includes("Data truncated"))

        // The bullet is a muted status marker, the label default text.
        const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
        const bullet = spans.find((span) => span.text.trim() === "•")
        const label = spans.find((span) => span.text.trim() === "Enabled")
        assert(bullet, "bullet span rendered")
        assert(label, "label span rendered")
        const mutedBullet = bullet.fg.toInts().toString()
        assert.notEqual(mutedBullet, label.fg.toInts().toString())

        // Real capture path: enable automatic consolidation before one actual
        // turn publishes the typed consolidation's saved event for this session.
        await command("/memory auto on", "Automatic consolidation enabled.")
        return mutedBullet
      })
      yield* Effect.tryPromise(async () => {
        const watcher = setup.waitForFrame(
          (frame) => {
            const line = setup
              .captureSpans()
              .lines.flatMap((entry) => entry.spans)
              .find((span) => span.text.trim() === "•")
            return Boolean(line && line.fg.toInts().toString() !== mutedBullet) && frame.includes("• Enabled")
          },
          { maxPasses: 1200 },
        )
        await client.session.prompt({ sessionID: session.id, text: "pulse trigger turn" })
        await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(15_000) })
        // The saved event pulses the bullet success, then the 5s pulse expires
        // back to the muted Enabled row without new saves.
        await watcher
        await setup.waitForFrame(
          (frame) => {
            const current = setup
              .captureSpans()
              .lines.flatMap((entry) => entry.spans)
              .find((span) => span.text.trim() === "•")
            return frame.includes("• Enabled") && current?.fg.toInts().toString() === mutedBullet
          },
          { maxPasses: 1200 },
        )

        // A real save attributed to another session never pulses this sidebar.
        const status = await rpc.status({}, { location })
        const other = await client.session.create({ title: "Memory sidebar other session", location })
        await KiloMemory.apply({
          root: status.root,
          ops: [{ action: "add", key: "other_pulse", text: "other session pulse" }],
          sessionID: other.id,
        })
        await Bun.sleep(1_000)
        const steady = setup.captureSpans().lines.flatMap((entry) => entry.spans)
        const steadyBullet = steady.find((span) => span.text.trim() === "•")
        assert(steadyBullet, "bullet span still rendered")
        assert.equal(steadyBullet.fg.toInts().toString(), mutedBullet)

        // A later request receives the saved memory as real context. With auto
        // save off, a persistent active marker cannot be explained by a pulse.
        await command("/memory auto off", "Automatic consolidation disabled.")
        assert.equal((await rpc.status({ sessionID: session.id }, { location })).session?.injected, false)
        await client.session.prompt({ sessionID: session.id, text: "use the saved local context" })
        await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(15_000) })
        assert.equal((await rpc.status({ sessionID: session.id }, { location })).session?.injected, true)
        assert.equal((await rpc.status({ sessionID: other.id }, { location })).session?.injected, false)
        await setup.waitForFrame(
          (frame) =>
            frame.includes("• Enabled") &&
            setup
              .captureSpans()
              .lines.flatMap((line) => line.spans)
              .some((span) => span.text.trim() === "•" && span.fg.toInts().toString() !== mutedBullet),
          { maxPasses: 600 },
        )
        injectedSession.resolve(session.id)

        // Narrow widths let the native auto-sidebar policy hide the sidebar; the
        // memory row must disappear and return without a model request.
        setup.resize(100, 40)
        await setup.waitForFrame((frame) => !frame.includes("• Enabled"), { maxPasses: 600 })
        setup.resize(140, 45)
        await setup.waitForFrame(
          (frame) =>
            frame.includes("• Enabled") &&
            setup
              .captureSpans()
              .lines.flatMap((line) => line.spans)
              .some((span) => span.text.trim() === "•" && span.fg.toInts().toString() !== mutedBullet),
          { maxPasses: 600 },
        )

        await command("/memory disable", "Memory disabled.")
        await setup.waitForFrame((frame) => frame.includes("• Disabled") && !frame.includes("• Enabled"), {
          maxPasses: 600,
        })
      })
      assert.equal(typeof mutedBullet, "string")
      assert.notEqual(mutedBullet, "")
      const sessions = yield* Effect.promise(() => client.session.list({ directory: location.directory }))
      assert.equal(sessions.data.length, 2)
      // The pulse and injection requests are the only visible session work; memory capture never
      // admits extra messages or inbox items.
      const messages = yield* Effect.promise(() => client.message.list({ sessionID: session.id }))
      const kinds = messages.data.map((message) => message.type).sort()
      assert.deepEqual(kinds, ["assistant", "assistant", "user", "user"])
      const inbox = yield* Effect.promise(() => client.session.inbox.list({ sessionID: session.id }))
      if (inbox.length) console.error("unexpected inbox items:", JSON.stringify(inbox))
      assert.deepEqual(inbox, [])
      const finalStatus = yield* Effect.promise(() => rpc.status({}, { location }))
      assert.equal(finalStatus.state.enabled, false)
      // The saved operation persisted through the real capture path.
      assert(finalStatus.index.text.includes("sidebar_pulse_note"))
      yield* Effect.promise(async () => {
        await setup.mockInput.typeText("/exit")
        setup.mockInput.pressEnter()
        await closed.promise
      })
      yield* Fiber.join(fiber)
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
)

async function command(input: string, message: string) {
  await setup.mockInput.typeText(input)
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes(message), { maxPasses: 600 })
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => !frame.includes(message), { maxPasses: 600 })
}

try {
  await task
  // A new host on the same layout must read the durable activity fact; it is
  // independent of both the old renderer and the plugin activation lifetime.
  const sessionID = await injectedSession.promise
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* launch(input, { models: false, recover: false })
        const client = createClient({
          baseUrl: endpoint.url,
          headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
        })
        const location = { directory: process.cwd() }
        yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
        const status = yield* Effect.promise(() => client.rpc(MemoryRpc.Definition).status({ sessionID }, { location }))
        assert.deepEqual(status.session, { id: sessionID, injected: true })
        assert.equal(status.state.enabled, false, "activity evidence never enables memory")
        const other = { directory: input.paths.cache }
        yield* Effect.promise(() => client.plugin.awaitActivation({ location: other }))
        yield* Effect.promise(() =>
          assert.rejects(client.rpc(MemoryRpc.Definition).status({ sessionID }, { location: other })),
        )
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
  assert.equal(setup.renderer.isDestroyed, true)
  console.log("TUI_SIDEBAR_MEMORY_FIXTURE_OK")
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  await model.stop(true)
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
}
