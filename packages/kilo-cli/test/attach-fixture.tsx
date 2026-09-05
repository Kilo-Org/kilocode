import { OpenCode } from "@opencode-ai/client"
import { NodeHttpServer } from "@effect/platform-node"
import { Service } from "@opencode-ai/client/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import path from "node:path"
import { start, status, stop } from "../src/daemon"
import { layout } from "../src/paths"
import { runTui } from "../src/tui"

const input = layout("interactive")
try {
  const endpoint = await start(input, {
    command: [process.execPath, "--no-env-file", path.join(import.meta.dir, "daemon-fixture.ts"), "serve"],
  })
  const initial = await status(input)
  assert.equal(initial.state, "running")
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  const session = await client.session.create({
    location: { directory: process.cwd() },
    model: { providerID: "fixture", id: "chat" },
  })
  for (const attempt of [1, 2]) {
    const setup = await createTestRenderer({ width: 120, height: 40, useThread: false, kittyKeyboard: true })
    setup.renderer.start()
    const ready = Promise.withResolvers<void>()
    const closed = Promise.withResolvers<void>()
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fiber = yield* Effect.forkScoped(
              runTui(input, endpoint, {
                args: { sessionID: session.id },
                terminalHandoff: async () => ({
                  renderer: setup.renderer,
                  mode: "dark" as const,
                  complete: ready.resolve,
                }),
              }).pipe(Effect.ensuring(Effect.sync(closed.resolve))),
            )
            yield* Effect.promise(async () => {
              await Promise.race([
                ready.promise,
                closed.promise.then(() => {
                  throw new Error("Attach closed before ready")
                }),
              ])
              if (attempt === 2)
                await setup.waitForFrame((frame) => frame.includes("Attach prompt 1"), { maxPasses: 600 })
              await setup.waitForFrame((frame) => frame.includes("Code") && frame.includes("chat"), { maxPasses: 600 })
              await setup.mockInput.typeText(`Attach prompt ${attempt}`)
              await setup.waitForFrame((frame) => frame.includes(`Attach prompt ${attempt}`), { maxPasses: 600 })
              setup.mockInput.pressEnter()
              await setup.waitFor(
                async () => {
                  const messages = await client.message.list({ sessionID: session.id, order: "asc" })
                  return (
                    messages.data.filter((message) => message.type === "assistant").length >= attempt &&
                    Object.keys(await client.session.active()).length === 0
                  )
                },
                { maxPasses: 600 },
              )
              await setup.waitForFrame((frame) => frame.includes("Attached daemon response"), { maxPasses: 600 })
              await setup.mockInput.typeText("/exit")
              setup.mockInput.pressEnter()
              await closed.promise
            })
            yield* Fiber.join(fiber)
          }),
        ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
      )
      const current = await status(input)
      assert.equal(current.state, "running")
      if (current.state === "running" && initial.state === "running") assert.equal(current.pid, initial.pid)
    } catch (error) {
      console.error(`Attach attempt ${attempt}:\n${setup.captureCharFrame()}`)
      throw error
    } finally {
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    }
  }
  console.log("ATTACH_FIXTURE_OK")
} finally {
  await stop(input)
}
