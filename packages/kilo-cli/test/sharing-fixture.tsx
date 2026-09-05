import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Session } from "@opencode-ai/schema/session"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { runTui } from "../src/tui"

const mode = process.argv[2]
assert(mode === "cancel" || mode === "fork" || mode === "revoke", `Unknown mode: ${mode}`)

const gatewayURL = process.env.KILO_FIXTURE_GATEWAY
assert(gatewayURL, "KILO_FIXTURE_GATEWAY must be set")

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
        gateway: { server: gatewayURL, sessions: gatewayURL, pollIntervalMs: 10 },
      })
      const client = createClient({
        baseUrl: endpoint.url,
        headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
      })
      const location = { directory: process.cwd() }
      yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
      yield* Effect.promise(async () => {
        const attempt = await client.integration.oauth.connect({
          integrationID: "kilo",
          methodID: "device",
          location,
        })
        const deadline = Date.now() + 5000
        while (true) {
          const status = await client.integration.oauth.status({
            integrationID: "kilo",
            attemptID: attempt.data.attemptID,
            location,
          })
          if (status.data.status === "complete") return
          if (status.data.status !== "pending") throw new Error(`Device login failed: ${JSON.stringify(status.data)}`)
          if (Date.now() > deadline) throw new Error("Device login timed out")
          await Bun.sleep(20)
        }
      })
      const session = yield* Effect.promise(() =>
        client.session.import({
          info: {
            id: Session.ID.create(),
            projectID: "fixture",
            title: "Sharing fixture",
            location,
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1, idle: 1, viewed: 1 },
          },
          messages: [
            { id: "msg_sharingfixture", type: "user", text: "Shared fixture transcript", time: { created: 1 } },
          ],
          location,
        }),
      )
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
        await setup.waitForFrame((frame) => frame.includes("Sharing fixture"), { maxPasses: 600 })

        await setup.mockInput.typeText("/share")
        setup.mockInput.pressEnter()
        await setup.waitForFrame(
          (frame) =>
            frame.includes("Share session publicly") &&
            frame.includes("uploads the session transcript") &&
            frame.includes("publicly accessible"),
          { maxPasses: 600 },
        )
        if (mode === "cancel") {
          setup.mockInput.pressEscape()
          await setup.waitForFrame((frame) => !frame.includes("Share session publicly"), { maxPasses: 600 })
        } else {
          setup.mockInput.pressEnter()
          await setup.waitForFrame(
            (frame) =>
              frame.includes("Session shared") &&
              (frame.includes("Public share URL") || frame.includes("copied to clipboard")),
            { maxPasses: 600 },
          )

          if (mode === "revoke") {
            await setup.mockInput.typeText("/unshare")
            setup.mockInput.pressEnter()
            await setup.waitForFrame((frame) => frame.includes("Session unshared"), { maxPasses: 600 })
          }

          await setup.mockInput.typeText("/fork-from-share https://app.kilo.ai/s/fixture.payload.signature")
          setup.mockInput.pressEnter()
          await setup.waitForFrame(
            (frame) => frame.includes(mode === "revoke" ? "Shared session not found" : "Forked shared session"),
            { maxPasses: 600 },
          )
          const imported = (await client.session.list()).data.filter((item) => item.id !== session.id)
          assert.equal(imported.length, mode === "revoke" ? 0 : 1)
          if (mode === "fork") {
            const fork = imported[0]
            assert(
              JSON.stringify(await client.message.list({ sessionID: fork.id })).includes("Shared fixture transcript"),
            )
            await client.session.rename({ sessionID: fork.id, title: "Imported sharing fixture" })
            await setup.waitForFrame((frame) => frame.includes("Imported sharing fixture"), { maxPasses: 600 })
          }
        }

        await setup.mockInput.typeText("/exit")
        setup.mockInput.pressEnter()
        await closed.promise
        assert.equal(setup.renderer.isDestroyed, true)
      })
      yield* Fiber.join(fiber)
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
)

try {
  await task
  assert.equal(setup.renderer.isDestroyed, true)
  console.log(`TUI_SHARING_FIXTURE_OK:${mode}`)
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
}
