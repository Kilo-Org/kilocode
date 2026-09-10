import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Exit, Fiber } from "effect"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import manifest from "../package.json"
import { launch } from "../src/interactive-server"
import { guardedFixtureLayout } from "./fixture"
import { runTui } from "../src/tui"

const scenario = process.env.TUI_BENCH_SCENARIO
assert(scenario === "valid" || scenario === "absent" || scenario === "invalid" || scenario === "switch")

const setup = await createTestRenderer({ width: 160, height: 40, useThread: false, kittyKeyboard: true })
setup.renderer.start()

const root = mkdtempSync(path.join(os.tmpdir(), "kilo-bench-fixture-"))
const repo = path.join(root, "repo")
const repo2 = path.join(root, "repo2")
await Promise.all([repo, repo2].map((directory) => mkdirSync(directory, { recursive: true })))

// Loopback-only catalog fixture. The bench record mirrors the pinned v1 wire shape
// (kilo-gateway/src/api/models.ts:48): { overallScore, avgAttemptCostUsd } finite numbers.
const benchRecord = { overallScore: 0.425, avgAttemptCostUsd: 1.23 }
const personalModel = {
  id: "kilo-auto/bench",
  name: "Bench Fixture Auto",
  context_length: 128000,
  supported_parameters: ["tools"],
  ...(scenario === "invalid"
    ? { terminalBench: { overallScore: "high", avgAttemptCostUsd: 1.23 } }
    : { terminalBench: benchRecord }),
}
const catalog = {
  data: [
    ...(scenario === "absent" ? [] : [personalModel]),
    { id: "kilo-auto/plain", name: "Plain Fixture Auto", context_length: 128000, supported_parameters: ["tools"] },
    { id: "ordinary", name: "Ordinary", context_length: 128000, supported_parameters: ["tools"] },
  ],
}
// Holds team-catalog responses so the fixture can observe the renderer state
// while the sidebar's post-identity refetch is in flight.
const teamCatalog = {
  data: [
    { id: "kilo-auto/team", name: "Team Fixture Auto", context_length: 128000, supported_parameters: ["tools"] },
    { id: "ordinary", name: "Ordinary", context_length: 128000, supported_parameters: ["tools"] },
  ],
}
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/api/profile")
      return Response.json({
        organizations: [{ id: "team", name: "Bench Fixture Team", role: "member" }],
        selectedOrganizationId: null,
        hasPersonalAccount: true,
      })
    if (path === "/api/openrouter/models" || path === "/api/organizations/team/models") {
      // Anonymous startup probe: only the unauthenticated public models request
      // returns an empty catalog; authenticated and team assertions stay exact.
      if (path === "/api/openrouter/models" && request.headers.get("authorization") === null) {
        return Response.json({ data: [] })
      }
      assert.equal(request.headers.get("authorization"), "Bearer bench-fixture")
      return Response.json(path === "/api/openrouter/models" ? catalog : teamCatalog)
    }
    return new Response(null, { status: 404 })
  },
})

const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()

const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const input = guardedFixtureLayout()
      const endpoint = yield* launch(input, {
        models: false,
        recover: false,
        gateway: { server: gateway.url.origin },
        content: JSON.stringify({
          model: "kilo/ordinary",
          providers: {
            kilo: {
              package: "aisdk:@ai-sdk/openai-compatible",
              models: { ordinary: {} },
            },
          },
        }),
      })
      const client = createClient({
        baseUrl: endpoint.url,
        headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
      })
      const location = { directory: repo }
      yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
      yield* Effect.promise(() =>
        endpoint.importCredential({
          kind: "api-key",
          integrationID: "kilo",
          key: "bench-fixture",
          label: "Bench fixture",
          metadata: { server: gateway.url.origin, hasPersonalAccount: "true" },
        }),
      )
      yield* Effect.tryPromise(async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const inventory = await client.model.list({ location })
          if (inventory.data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/plain")) return
          await Bun.sleep(20)
        }
        throw new Error("Kilo catalog did not activate")
      })

      // Account switch through the public RPC, plus a credential touch: the /teams
      // dialog itself bumps the TUI account revision after a switch; outside the TUI the
      // equivalent observable trigger is a credential event, which the TUI's account
      // watcher treats identically (profile refresh + revision bump).
      // Account switch through the public RPC, then the /profile command: it is a
      // production TUI trigger whose account refresh bumps the revision that the
      // sidebar's identity watches, without touching the credential selection.
      // Account switch through the public RPC (the server-side catalog refreshes to the
      // selected scope), then the /profile command: it is a production TUI trigger whose
      // account refresh bumps the revision that the sidebar's identity watches.
      async function switchAccount(organizationID: string | null, option: string) {
        await client.kilocode.organization.set({ organizationID })
        setup.mockInput.pressKey("p", { ctrl: true })
        await setup.waitForFrame((frame) => frame.includes("Commands"), { maxPasses: 600 })
        await Bun.sleep(300)
        await setup.mockInput.typeText("Kilo account profile")
        await setup.waitForFrame((frame) => frame.includes("Commands") && frame.includes("Kilo account profile"), {
          maxPasses: 600,
        })
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("Reveal Kilo account details?") || frame.includes(option), {
          maxPasses: 600,
        })
        if (setup.captureCharFrame().includes("Reveal Kilo account details?")) {
          setup.mockInput.pressEnter()
          await setup.waitForFrame((frame) => frame.includes(option), { maxPasses: 600 })
        }
        setup.mockInput.pressKey("ESCAPE")
        await setup.waitForFrame((frame) => !frame.includes("Commands"), { maxPasses: 600 })
      }

      const benchModel = { providerID: "kilo", id: "kilo-auto/bench" }
      const plainModel = { providerID: "kilo", id: "kilo-auto/plain" }
      const session = yield* Effect.promise(() =>
        client.session.create({ title: "Bench sidebar fixture", location, model: benchModel }),
      )
      yield* Effect.promise(() => client.session.switchModel({ sessionID: session.id, model: plainModel }))
      yield* Effect.promise(() => client.session.switchModel({ sessionID: session.id, model: benchModel }))
      const fiber = yield* Effect.forkScoped(
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            runTui(input, endpoint, {
              args: { sessionID: session.id },
              terminalHandoff: async () => ({
                renderer: setup.renderer,
                mode: "dark" as const,
                complete: ready.resolve,
              }),
            }),
          )
          if (Exit.isFailure(exit)) console.error("TUI_EXIT", Bun.inspect(exit.cause, { depth: 12 }).slice(0, 4000))
        }).pipe(Effect.ensuring(Effect.sync(closed.resolve))),
      )
      yield* Effect.tryPromise(async () => {
        await Promise.race([
          ready.promise,
          closed.promise.then(() => {
            throw new Error("TUI closed before terminal handoff")
          }),
        ])
        await setup.waitForFrame((frame) => frame.includes("Bench sidebar fixture"), { maxPasses: 600 })

        if (scenario === "valid") {
          await setup.waitForFrame(
            (frame) => frame.includes("Terminal Bench 2.0") && frame.includes("42.5%") && frame.includes("$1.23"),
            { maxPasses: 600 },
          )
          // The bench rows render in the theme's subdued text tone (pinned v1
          // textMuted), distinct from the section title's default tone.
          const frame = setup.captureCharFrame()
          const lines = frame.split("\n")
          const width = lines[0]?.length ?? 0
          const fgBuffer = () => {
            const buffers = (setup.renderer.currentRenderBuffer as unknown as { buffers: { fg: Float32Array } }).buffers
            return buffers.fg
          }
          const cellFg = (needle: string) => {
            const lineIndex = lines.findIndex((line) => line.includes(needle))
            assert(lineIndex >= 0, `expected ${needle} in the frame`)
            const column = lines[lineIndex].indexOf(needle)
            const fg = fgBuffer()
            const cell = (lineIndex * width + column) * 4
            return [fg[cell], fg[cell + 1], fg[cell + 2], fg[cell + 3]] as const
          }
          const rowFg = cellFg("Cost / attempt")
          const titleFg = cellFg("Terminal Bench 2.0")
          const memoryLineIndex = lines.findIndex(
            (line) =>
              line.includes("•") && (line.includes("Disabled") || line.includes("Loading") || line.includes("Enabled")),
          )
          assert(memoryLineIndex >= 0, "expected the memory status row in the frame")
          const memoryColumn = lines[memoryLineIndex].indexOf("•")
          const fg = fgBuffer()
          const subduedCell = (memoryLineIndex * width + memoryColumn) * 4
          const subduedFg = [fg[subduedCell], fg[subduedCell + 1], fg[subduedCell + 2], fg[subduedCell + 3]] as const
          const close = (a: readonly number[], b: readonly number[]) =>
            a.every((component, index) => Math.abs(component - b[index]) < 0.01)
          assert(!close(rowFg, titleFg), "bench rows must not render in the default text tone")
          assert(close(rowFg, subduedFg), "bench rows must render in the theme's subdued text tone")
          // A width change that keeps the sidebar visible must not disturb the section.
          setup.resize(150, 40)
          await Bun.sleep(400)
          assert(setup.captureCharFrame().includes("42.5%"), "bench section survives a keeping-width resize")
          // The native auto-sidebar policy hides the section at narrow widths and
          // restores it at wide widths.
          for (const width of [160, 150]) {
            setup.resize(100, 40)
            await setup.waitForFrame((frame) => !frame.includes("Terminal Bench 2.0"), { maxPasses: 600 })
            setup.resize(width, 40)
            await setup.waitForFrame((frame) => frame.includes("42.5%"), { maxPasses: 600 })
            const restored = setup.captureCharFrame()
            assert.equal(restored.split("Credits").length - 1, 1, "resize must not duplicate account sections")
            assert.equal(restored.split(`Kilo ${manifest.version}`).length - 1, 1, "resize must not duplicate the version")
          }
        }

        if (scenario === "absent") {
          await Bun.sleep(1200)
          assert(!setup.captureCharFrame().includes("Terminal Bench 2.0"), "no bench section without catalog metadata")
          const inventory = await client.model.list({ location })
          assert(
            inventory.data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/plain"),
            JSON.stringify(inventory.data),
          )
        }

        if (scenario === "invalid") {
          await Bun.sleep(1200)
          assert(!setup.captureCharFrame().includes("Terminal Bench 2.0"), "malformed metadata must render no section")
          assert(!setup.captureCharFrame().includes("42.5%"), "no invented bench value")
          const inventory = await client.model.list({ location })
          assert(
            inventory.data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/bench"),
            "a model with malformed bench metadata must stay in the catalog",
          )
        }

        if (scenario === "switch") {
          await setup.waitForFrame((frame) => frame.includes("42.5%") && frame.includes("$1.23"), { maxPasses: 600 })
          // Model switch within the same session: the plain model carries no bench
          // metadata, so the section must disappear and never show a stale value.
          await client.session.switchModel({ sessionID: session.id, model: plainModel })
          await setup.waitForFrame((frame) => !frame.includes("Terminal Bench 2.0"), { maxPasses: 600 })
          await Bun.sleep(400)
          assert(!setup.captureCharFrame().includes("42.5%"), "no stale bench value after a model switch")
          await client.session.switchModel({ sessionID: session.id, model: benchModel })
          await setup.waitForFrame((frame) => frame.includes("42.5%"), { maxPasses: 600 })
          // The /teams dialog is the production account switch: it bumps the TUI
          // account revision, which is what drives the sidebar's refetch.
          await switchAccount("team", "Bench Fixture Team")
          await (async () => {
            for (let attempt = 0; attempt < 100; attempt++) {
              const inventory = await client.model.list({ location })
              if (inventory.data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/team")) return
              await Bun.sleep(50)
            }
            throw new Error("Team catalog did not load")
          })()
          await setup.waitForFrame((frame) => !frame.includes("Terminal Bench 2.0"), { maxPasses: 600 })
          await Bun.sleep(500)
          assert(!setup.captureCharFrame().includes("42.5%"), "no stale personal bench value in the team scope")

          // Switch back: the personal catalog is served again and the section returns.
          await switchAccount(null, "Personal account")
          await setup.waitForFrame((frame) => frame.includes("42.5%") && frame.includes("$1.23"), { maxPasses: 600 })
        }

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
  console.log(`TUI_BENCH_${scenario.toUpperCase()}_OK`)
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  await gateway.stop(true)
}
