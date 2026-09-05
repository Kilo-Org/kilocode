import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import path from "node:path"
import { MemoryRpc } from "../src/memory-rpc"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { runTui } from "../src/tui"

const setup = await createTestRenderer({ width: 120, height: 40, useThread: false, kittyKeyboard: true })
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
      const commands = yield* Effect.promise(() => client.command.list({ location }))
      assert(commands.data.some((command) => command.name === "memory"))
      const initial = yield* Effect.promise(() => rpc.status({}, { location }))
      const projectMemoryRoot = path.join(input.paths.data, "memory")
      assert.equal(initial.state.enabled, false)
      assert.equal(initial.state.scope, "project")
      assert(initial.root.startsWith(`${projectMemoryRoot}${path.sep}`))

      const before = yield* Effect.promise(() => client.session.list({ directory: location.directory }))
      assert.equal(before.data.length, 0)

      const tui = runTui(input, endpoint, { terminalHandoff })
      const fiber = yield* Effect.forkScoped(tui.pipe(Effect.ensuring(Effect.sync(closed.resolve))))
      yield* Effect.tryPromise(async () => {
        await Promise.race([
          ready.promise,
          closed.promise.then(async () => {
            await Effect.runPromise(Fiber.join(fiber))
            throw new Error("TUI closed before terminal handoff")
          }),
        ])
        await setup.waitForFrame((frame) => frame.includes("Kilo internal preview"), { maxPasses: 600 })

        await setup.mockInput.typeText("/memory")
        const autocomplete = await setup.waitForFrame(
          (frame) => frame.includes("Manage explicit local project memory"),
          { maxPasses: 600 },
        )
        assert.equal(
          autocomplete.split("\n").filter((line) => line.includes("Manage explicit local project memory")).length,
          1,
        )
        setup.mockInput.pressKey("c", { ctrl: true })
        await setup.waitForFrame((frame) => !frame.includes("Manage explicit local project memory"), { maxPasses: 600 })

        const command = async (input: string, message: string) => {
          await setup.mockInput.typeText(input)
          setup.mockInput.pressEnter()
          await setup.waitForFrame((frame) => frame.includes(message), { maxPasses: 600 })
          setup.mockInput.pressEnter()
          await setup.waitForFrame((frame) => !frame.includes(message), { maxPasses: 600 })
        }

        await command("/memory status", "Memory disabled.")
        await command("/memory enable", "Memory enabled.")
        await command("/memory auto on", "Automatic consolidation enabled.")
        await command("/memory remember ui regression note", "Memory saved (1 change).")
        await command("/memory show", "ui regression note")

        const final = await rpc.status({}, { location })
        const shown = await rpc.show({}, { location })
        assert.equal(final.state.enabled, true)
        assert.equal(final.state.autoConsolidate, true)
        assert.equal(final.state.scope, "project")
        assert.equal(final.root, initial.root)
        assert(shown.sources["project.md"].includes("ui_regression_note :: ui regression note"))
        assert.equal(shown.root, initial.root)

        const after = await client.session.list({ directory: location.directory })
        assert.equal(after.data.length, 0)
        for (const session of after.data)
          assert.deepEqual(await client.session.inbox.list({ sessionID: session.id }), [])

        await setup.mockInput.typeText("/exit")
        setup.mockInput.pressEnter()
        await closed.promise
      })
      yield* Fiber.join(fiber)
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
)

try {
  await task
  assert.equal(setup.renderer.isDestroyed, true)
  console.log("TUI_MEMORY_FIXTURE_OK")
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
}
