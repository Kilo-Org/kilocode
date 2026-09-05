import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { IndexingRpc } from "../src/indexing-rpc"
import { layout } from "../src/paths"
import { runTui } from "../src/tui"

const setup = await createTestRenderer({ width: 160, height: 40, useThread: false })
setup.renderer.start()
const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
try {
  await Effect.runPromise(
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
        const status = yield* Effect.promise(() => client.rpc(IndexingRpc).status({}, { location }))
        assert.equal(status.state, "Disabled")
        assert.equal(status.totalFiles, 0)
        const session = yield* Effect.promise(() =>
          client.session.create({ title: "Indexing sidebar fixture", location }),
        )
        const fiber = yield* Effect.forkScoped(
          runTui(input, endpoint, {
            args: { sessionID: session.id },
            terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve }),
          }).pipe(Effect.ensuring(Effect.sync(closed.resolve))),
        )
        yield* Effect.promise(async () => {
          await Promise.race([
            ready.promise,
            closed.promise.then(() => {
              throw new Error("TUI closed before handoff")
            }),
          ])
          await setup.waitForFrame((frame) => /Code Indexing\s*\n\s*Disabled/.test(frame), { maxPasses: 600 })
          assert.equal(await Bun.file(path.join(input.paths.state, "indexing")).exists(), false)
          assert.deepEqual((await client.message.list({ sessionID: session.id })).data, [])
          assert.deepEqual(await client.session.inbox.list({ sessionID: session.id }), [])
          // No global/default-location fallback should be needed to keep the section visible.
          setup.resize(140, 45)
          await setup.waitForFrame((frame) => /Code Indexing\s*\n\s*Disabled/.test(frame), { maxPasses: 600 })
          await setup.mockInput.typeText("/exit")
          setup.mockInput.pressEnter()
          await closed.promise
        })
        yield* Fiber.join(fiber)
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
  console.log("TUI_INDEXING_STATUS_OK")
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
}
