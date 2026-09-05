import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { RGBA, TextRenderable } from "@opentui/core"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { runTui } from "../src/tui"

const mode = process.argv[2] ?? "standard"
assert(mode === "standard" || mode === "no-personal" || mode === "connect", `Unknown mode: ${mode}`)

const gatewayUrl = process.env.KILO_FIXTURE_GATEWAY
assert(gatewayUrl, "KILO_FIXTURE_GATEWAY must be set")

const setup = await createTestRenderer({ width: 120, height: 40, useThread: false, kittyKeyboard: true })
setup.renderer.start()

const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
const terminalHandoff = async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve })

async function enterCommand(command: string) {
  const frameID = setup.renderer.frameId
  setup.mockInput.pressKey("A", { ctrl: true })
  await setup.mockInput.typeText(command)
  // The footer advertises /teams, so it cannot prove the focused composer received this command.
  await setup.waitFor(() => setup.renderer.frameId > frameID, { maxPasses: 600 })
  await setup.waitForFrame(
    (frame) =>
      frame
        .split("\n")
        .some((line) => !line.includes("Kilo internal preview") && line.replaceAll("┃", "").trim() === command),
    { maxPasses: 600 },
  )
  setup.mockInput.pressEnter()
}

async function waitForComposer(frameID: number, account: string) {
  await setup.waitFor(() => setup.renderer.frameId > frameID, { maxPasses: 600 })
  await setup.waitForFrame((frame) => !frame.includes("Switch Kilo account") && frame.includes(account), {
    maxPasses: 600,
  })
}

const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const input = layout("interactive")
      const endpoint = yield* launch(input, {
        models: false,
        gateway: { server: gatewayUrl, pollIntervalMs: 10 },
      })
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

        // 1. Initial footer before sign-in
        await setup.waitForFrame((frame) => frame.includes("Connect Kilo to sign in · /teams"), { maxPasses: 600 })
        const logo = setup.renderer.root.findDescendantById("kilo-home-logo")
        assert(logo instanceof TextRenderable)
        assert(logo.fg?.equals(RGBA.fromHex("#f9f76f")))
        if (mode === "connect") {
          await enterCommand("/connect")
          const connect = await setup.waitForFrame(
            (frame) => frame.includes("Connect an integration") && frame.includes("Kilo Gateway"),
            { maxPasses: 600 },
          )
          const lines = connect.split("\n")
          const popular = lines.findIndex((line) => line.includes("Popular"))
          assert(popular >= 0)
          assert(
            lines
              .slice(popular + 1)
              .find((line) => line.trim())
              ?.includes("Kilo Gateway"),
          )
          assert(connect.includes("Recommended"))
          const closeFrameID = setup.renderer.frameId
          setup.mockInput.pressEscape()
          await waitForComposer(closeFrameID, "Connect Kilo to sign in")
          await enterCommand("/exit")
          await closed.promise
          assert.equal(setup.renderer.isDestroyed, true)
          return
        }

        // 2. Perform device login using public integration.oauth API
        const client = createClient({
          baseUrl: endpoint.url,
          headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
        })

        const location = { directory: process.cwd() }
        await client.plugin.awaitActivation({ location }, { signal: AbortSignal.timeout(5000) })

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
          if (status.data.status !== "pending") {
            throw new Error(`Device login failed: ${JSON.stringify(status.data)}`)
          }
          if (Date.now() > deadline) throw new Error("Device login timed out")
          await Bun.sleep(20)
        }

        // 3. Footer updates with logged-in account
        await setup.waitForFrame(
          (frame) => frame.includes("Fixture team") && frame.includes("fixture@example.test · /teams"),
          { maxPasses: 600 },
        )

        if (mode === "standard") {
          // Select Other team in DialogSelect
          await enterCommand("/teams")
          await setup.waitForFrame(
            (frame) =>
              frame.includes("Switch Kilo account") && frame.includes("Fixture team") && frame.includes("Other team"),
            { maxPasses: 600 },
          )
          await setup.mockInput.typeText("Other team")
          await setup.waitForFrame((frame) => frame.includes("Switch Kilo account") && frame.includes("Other team"), {
            maxPasses: 600,
          })
          const otherSelectionFrameID = setup.renderer.frameId
          setup.mockInput.pressEnter()

          // Footer reflects returned account
          await waitForComposer(otherSelectionFrameID, "Other team · fixture@example.test · /teams")
          const profileOther = await client.kilocode.profile()
          assert.equal(profileOther.currentOrganizationID, "org-other")

          // Select Personal account in DialogSelect
          await enterCommand("/teams")
          await setup.waitForFrame(
            (frame) =>
              frame.includes("Switch Kilo account") &&
              frame.includes("Other team") &&
              frame.includes("Personal account"),
            { maxPasses: 600 },
          )
          await setup.mockInput.typeText("Personal account")
          await setup.waitForFrame(
            (frame) => frame.includes("Switch Kilo account") && frame.includes("Personal account"),
            { maxPasses: 600 },
          )
          const personalSelectionFrameID = setup.renderer.frameId
          setup.mockInput.pressEnter()

          // Footer reflects Personal account
          await waitForComposer(personalSelectionFrameID, "Personal account · fixture@example.test · /teams")
          const profilePersonal = await client.kilocode.profile()
          assert.equal(profilePersonal.currentOrganizationID, null)

          // Cancel does not switch
          await enterCommand("/teams")
          await setup.waitForFrame(
            (frame) =>
              frame.includes("Switch Kilo account") &&
              frame.includes("Fixture team") &&
              frame.includes("Personal account"),
            { maxPasses: 600 },
          )
          const cancelFrameID = setup.renderer.frameId
          setup.mockInput.pressEscape()
          await waitForComposer(cancelFrameID, "Personal account · fixture@example.test · /teams")
          const frame = setup.captureCharFrame()
          assert(frame.includes("Personal account · fixture@example.test · /teams"))
          const profileAfterCancel = await client.kilocode.profile()
          assert.equal(profileAfterCancel.currentOrganizationID, null)
        }

        if (mode === "no-personal") {
          // Open /teams dialog
          await enterCommand("/teams")
          const dialogFrame = await setup.waitForFrame(
            (frame) =>
              frame.includes("Switch Kilo account") && frame.includes("Fixture team") && frame.includes("Other team"),
            { maxPasses: 600 },
          )

          // Verify Personal account is omitted, but organizations are present
          assert(
            !dialogFrame.includes("Personal account"),
            "Dialog must omit Personal account when hasPersonalAccount is false",
          )
          assert(dialogFrame.includes("Fixture team"), "Dialog must contain Fixture team")
          assert(dialogFrame.includes("Other team"), "Dialog must contain Other team")

          // Cancel dialog
          const cancelFrameID = setup.renderer.frameId
          setup.mockInput.pressEscape()
          await waitForComposer(cancelFrameID, "Fixture team · fixture@example.test · /teams")
        }

        // Clean exit
        await enterCommand("/exit")
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
  console.log(`TUI_TEAMS_FIXTURE_OK:${mode}`)
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
}
