import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { PrivacyRpc } from "../src/privacy-rpc"
import { runTui } from "../src/tui"

const gatewayUrl = process.env.KILO_FIXTURE_GATEWAY
assert(gatewayUrl, "KILO_FIXTURE_GATEWAY must be set")

const setup = await createTestRenderer({ width: 120, height: 40, useThread: false, kittyKeyboard: true })
setup.renderer.start()

const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
const terminalHandoff = async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve })

const input = layout("interactive")
await mkdir(path.dirname(input.config), { recursive: true })
await Bun.write(input.config, '{ "privacy_mode": true }\n')
const otherDirectory = path.join(process.cwd(), "..", "other-project")
await mkdir(otherDirectory, { recursive: true })

const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const endpoint = yield* launch(input, {
        models: false,
        recover: false,
        gateway: { server: gatewayUrl, pollIntervalMs: 10 },
      })
      const client = createClient({
        baseUrl: endpoint.url,
        headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
      })
      const location = { directory: process.cwd() }
      yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
      const privacy = client.rpc(PrivacyRpc.Definition)
      assert.equal((yield* Effect.promise(() => privacy.read({}, { location }))).enabled, true)

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

        await setup.waitForFrame((frame) => frame.includes("Connect Kilo to sign in · /teams"), { maxPasses: 600 })

        const attempt = await client.integration.oauth.connect(
          { integrationID: "kilo", methodID: "device", location },
          { signal: AbortSignal.timeout(5000) },
        )
        const deadline = Date.now() + 5000
        while (true) {
          const status = await client.integration.oauth.status({
            integrationID: "kilo",
            attemptID: attempt.data.attemptID,
            location,
          })
          if (status.data.status === "complete") break
          if (status.data.status !== "pending") throw new Error(`Device login failed: ${JSON.stringify(status.data)}`)
          if (Date.now() > deadline) throw new Error("Device login timed out")
          await Bun.sleep(20)
        }

        const hidden = await setup.waitForFrame(
          (frame) => frame.includes("Kilo account hidden · /teams") && !frame.includes("fixture@example.test"),
          { maxPasses: 600 },
        )
        await Bun.sleep(100)
        assert(setup.captureCharFrame().includes("Kilo account hidden · /teams"))
        assert(!hidden.includes("Fixture team"))
        assert(!hidden.includes("Other team"))

        // A second real client changes the same profile. The first TUI observes
        // the public event and updates without a polling round-trip.
        const observer = createClient({
          baseUrl: endpoint.url,
          headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
        })
        const observerPrivacy = observer.rpc(PrivacyRpc.Definition)
        const observerController = new AbortController()
        const observed = Promise.withResolvers<void>()
        const observerEvents: Array<{ enabled: boolean; directory: string }> = []
        const stopObserver = observerPrivacy.events.on(
          "updated",
          (event) => {
            observerEvents.push({ enabled: event.data.enabled, directory: event.location.directory })
            if (!event.data.enabled) observed.resolve()
          },
          { signal: observerController.signal },
        )
        await observerPrivacy.set({ enabled: false }, { location: { directory: otherDirectory } })
        await Promise.race([
          observed.promise,
          Bun.sleep(5000).then(() => {
            throw new Error("Second privacy observer did not receive the update event")
          }),
        ])
        await setup.waitForFrame((frame) => frame.includes("Fixture team · fixture@example.test · /teams"), {
          maxPasses: 600,
        })
        assert.deepEqual(observerEvents, [{ enabled: false, directory: otherDirectory }])

        // Abort the second observer before the first TUI changes the setting again.
        observerController.abort()
        await setup.mockInput.typeText("/privacy on")
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("Enabled for this isolated Kilo profile."), {
          maxPasses: 600,
        })
        await setup.waitForFrame((frame) => frame.includes("Kilo account hidden · /teams"), { maxPasses: 600 })
        await Bun.sleep(100)
        assert.deepEqual(observerEvents, [{ enabled: false, directory: otherDirectory }])
        stopObserver()

        // Privacy blocks both sensitive commands before their account dialogs are opened.
        await setup.mockInput.typeText("/profile")
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("Reveal Kilo account details?"), { maxPasses: 600 })
        setup.mockInput.pressEscape()
        await setup.waitForFrame((frame) => !frame.includes("Reveal Kilo account details?"), { maxPasses: 600 })

        await setup.mockInput.typeText("/teams")
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("Reveal Kilo account details?"), { maxPasses: 600 })
        setup.mockInput.pressEscape()
        await setup.waitForFrame((frame) => !frame.includes("Switch Kilo account"), { maxPasses: 600 })

        // The explicit runtime command changes only the isolated profile bit.
        await setup.mockInput.typeText("/privacy off")
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("Disabled for this isolated Kilo profile."), { maxPasses: 600 })
        await setup.waitForFrame((frame) => frame.includes("Fixture team · fixture@example.test · /teams"), {
          maxPasses: 600,
        })
        assert.equal((await Bun.file(input.config).json()).privacy_mode, false)

        // Re-enable and confirm that profile reveal displays only real Gateway fields.
        await setup.mockInput.typeText("/privacy on")
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("Enabled for this isolated Kilo profile."), {
          maxPasses: 600,
        })
        await setup.waitForFrame((frame) => frame.includes("Kilo account hidden · /teams"), { maxPasses: 600 })
        await setup.mockInput.typeText("/profile")
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("Reveal Kilo account details?"), { maxPasses: 600 })
        setup.mockInput.pressEnter()
        const profile = await setup.waitForFrame(
          (frame) =>
            frame.includes("Kilo account profile") &&
            frame.includes("Fixture") &&
            frame.includes("fixture@example.test") &&
            frame.includes("Fixture team"),
          { maxPasses: 600 },
        )
        assert(profile.includes("Fixture"))
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => !frame.includes("Kilo account profile"), { maxPasses: 600 })

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
  console.log("TUI_PRIVACY_FIXTURE_OK")
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
}
