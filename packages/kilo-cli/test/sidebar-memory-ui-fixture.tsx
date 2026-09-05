import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { MemoryRpc } from "../src/memory-rpc"
import { MemoryStore } from "../src/memory-plugin"
import { runTui } from "../src/tui"

const setup = await createTestRenderer({ width: 160, height: 40, useThread: false, kittyKeyboard: true })
setup.renderer.start()

const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
const terminalHandoff = async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve })

const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const input = layout("interactive")
      const endpoint = yield* launch(input, { models: false, recover: false })
      const client = createClient({
        baseUrl: endpoint.url,
        headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
      })
      const location = { directory: process.cwd() }
      yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
      const rpc = client.rpc(MemoryRpc.Definition)
      const session = yield* Effect.promise(() => client.session.create({ title: "Memory sidebar fixture", location }))
      const tui = runTui(input, endpoint, { args: { sessionID: session.id }, terminalHandoff })
      const fiber = yield* Effect.forkScoped(tui.pipe(Effect.ensuring(Effect.sync(closed.resolve))))
      yield* Effect.tryPromise(async () => {
        await Promise.race([
          ready.promise,
          closed.promise.then(async () => {
            await Effect.runPromise(Fiber.join(fiber))
            throw new Error("TUI closed before terminal handoff")
          }),
        ])
        await setup.waitForFrame((frame) => frame.includes("Memory sidebar fixture") && frame.includes("Disabled"), {
          maxPasses: 600,
        })

        const initial = setup.captureCharFrame()
        assert(!initial.includes("project.md"))
        assert(!initial.includes("environment.md"))
        assert(!initial.includes("corrections.md"))
        assert(!initial.includes("index.kmem"))

        await command("/memory enable", "Memory enabled.")
        await setup.waitForFrame(
          (frame) => frame.includes("Memory") && frame.includes("Enabled") && frame.includes("Auto: Off"),
          { maxPasses: 600 },
        )

        // Actual engine injection statistics arrive independently of a terminal
        // execution event, so the sidebar must refresh from persisted state.
        await rpc.remember({ text: "sidebar activity fixture" }, { location })
        const status = await rpc.status({}, { location })
        await MemoryStore.context(status.root)
        const injected = await rpc.status({}, { location })
        assert(injected.activity?.lastInjectedAt)
        await setup.waitForFrame(
          (frame) => frame.includes(`Injected: ${injected.activity!.lastInjectedTokens} estimated tokens`),
          { maxPasses: 600 },
        )
        setup.resize(140, 45)
        await setup.waitForFrame((frame) => frame.includes("Injected:") && frame.includes("Memory"), { maxPasses: 600 })

        await command("/memory disable", "Memory disabled.")
        await setup.waitForFrame(
          (frame) => frame.includes("Memory") && frame.includes("Disabled") && !frame.includes("Auto: On"),
          { maxPasses: 600 },
        )
      })
      const sessions = yield* Effect.promise(() => client.session.list({ directory: location.directory }))
      assert.equal(sessions.data.length, 1)
      const messages = yield* Effect.promise(() => client.message.list({ sessionID: session.id }))
      assert.deepEqual(messages.data, [])
      assert.deepEqual(yield* Effect.promise(() => client.session.inbox.list({ sessionID: session.id })), [])
      assert.equal((yield* Effect.promise(() => rpc.status({}, { location }))).state.enabled, false)
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
  assert.equal(setup.renderer.isDestroyed, true)
  console.log("TUI_SIDEBAR_MEMORY_FIXTURE_OK")
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
}
