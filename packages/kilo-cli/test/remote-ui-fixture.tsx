import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { REMOTE_LIMITATION, RemoteRpc } from "../src/remote-rpc"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { runTui } from "../src/tui"

let relayRequests = 0
const relay = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request, server) {
    relayRequests++
    if (new URL(request.url).pathname !== "/api/user/cli") return new Response(null, { status: 404 })
    if (server.upgrade(request)) return
    return new Response(null, { status: 400 })
  },
  websocket: { message() {} },
})

const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    return new Response(null, { status: 404 })
  },
})

const setup = await createTestRenderer({ width: 120, height: 40, useThread: false, kittyKeyboard: true })
setup.renderer.start()
const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
const terminalHandoff = async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve })

const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const input = layout("interactive")
      const endpoint = yield* launch(input, {
        models: false,
        recover: false,
        gateway: { server: gateway.url.origin },
        remote: { relayURL: relay.url.origin, allowHttpLoopback: true },
      })
      const client = createClient({
        baseUrl: endpoint.url,
        headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
      })
      const location = { directory: process.cwd() }
      yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
      const remote = client.rpc(RemoteRpc)
      assert.deepEqual(yield* Effect.promise(() => remote.status({}, { location })), {
        enabled: false,
        connected: false,
        directory: location.directory,
        note: REMOTE_LIMITATION,
      })
      assert.equal((yield* Effect.promise(() => client.session.list({ directory: location.directory }))).data.length, 0)

      const fiber = yield* Effect.forkScoped(
        runTui(input, endpoint, { terminalHandoff }).pipe(Effect.ensuring(Effect.sync(closed.resolve))),
      )
      yield* Effect.tryPromise(async () => {
        await Promise.race([
          ready.promise,
          closed.promise.then(async () => {
            await Effect.runPromise(Fiber.join(fiber))
            throw new Error("TUI closed before terminal handoff")
          }),
        ])
        await setup.waitForFrame((frame) => frame.includes("Kilo internal preview"), { maxPasses: 600 })

        const openRemote = async () => {
          await setup.mockInput.typeText("/remote")
          setup.mockInput.pressEnter()
          await setup.waitForFrame(
            (frame) => frame.includes("Remote control · Disabled") && frame.includes("Enable remote"),
            { maxPasses: 600 },
          )
        }

        // The first selectable action is Enable, but its confirmation must be
        // explicit: cancellation never resolves an account or dials the relay.
        await openRemote()
        setup.mockInput.pressEnter()
        await setup.waitForFrame(
          (frame) =>
            frame.includes("Enable remote control?") &&
            frame.includes("Preview control adapter only: legacy transcript") &&
            frame.includes("attachments and cloud-session cloning"),
          { maxPasses: 600 },
        )
        setup.mockInput.pressEscape()
        await setup.waitForFrame((frame) => !frame.includes("Enable remote control?"), { maxPasses: 600 })
        assert.equal((await remote.status({}, { location })).enabled, false)
        assert.equal(relayRequests, 0)

        // Limitations are visible before enabling and state the deliberately
        // excluded remote capabilities instead of suggesting session parity.
        await openRemote()
        setup.mockInput.pressArrow("down")
        setup.mockInput.pressEnter()
        await setup.waitForFrame(
          (frame) =>
            frame.includes("Remote preview limitations") &&
            frame.includes("Preview control adapter only: legacy transcript") &&
            frame.includes("attachments and cloud-session cloning"),
          { maxPasses: 600 },
        )
        setup.mockInput.pressEscape()
        await setup.waitForFrame((frame) => !frame.includes("Remote preview limitations"), { maxPasses: 600 })

        assert.equal((await remote.status({}, { location })).enabled, false)
        assert.equal(relayRequests, 0)
        assert.equal((await client.session.list({ directory: location.directory })).data.length, 0)

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
  console.log("TUI_REMOTE_FIXTURE_OK")
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  await relay.stop(true)
  await gateway.stop(true)
}
