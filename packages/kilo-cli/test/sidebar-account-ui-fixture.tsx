import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { guardedFixtureLayout } from "./fixture"
import { PrivacyRpc } from "../src/privacy-rpc"
import { runTui } from "../src/tui"

let personalBalance = 0
let personalPass = {
  subscription: {
    status: "active",
    currentPeriodBaseCreditsUsd: 19,
    currentPeriodUsageUsd: 3,
    currentPeriodBonusCreditsUsd: 2,
    nextBillingAt: "2026-10-01T00:00:00.000Z",
  },
}
let personalBalanceCalls = 0
let teamBalanceCalls = 0
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/profile") {
      assert.equal(request.headers.get("authorization"), "Bearer fixture-key")
      return Response.json({
        organizations: [{ id: "fixture-org", name: "Fixture Org" }],
        selectedOrganizationId: null,
        hasPersonalAccount: true,
      })
    }
    if (url.pathname === "/api/profile/balance") {
      const organization = request.headers.get("x-kilocode-organizationid")
      if (organization === null) {
        personalBalanceCalls++
        return Response.json({ balance: personalBalance })
      }
      if (organization === "fixture-org") {
        teamBalanceCalls++
        return Response.json({ balance: 40 })
      }
      return new Response(null, { status: 500 })
    }
    if (url.pathname === "/api/trpc/kiloPass.getState") {
      return Response.json([{ result: { data: { json: personalPass } } }])
    }
    return new Response(null, { status: 404 })
  },
})

const setup = await createTestRenderer({ width: 160, height: 40, useThread: false, kittyKeyboard: true })
setup.renderer.start()
const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
const terminalHandoff = async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve })

const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const input = guardedFixtureLayout()
      yield* Effect.promise(() => mkdir(path.dirname(input.config), { recursive: true }))
      yield* Effect.promise(() => Bun.write(input.config, '{ "privacy_mode": false }\n'))
      const endpoint = yield* launch(input, { models: false, recover: false, gateway: { server: gateway.url.origin } })
      const client = createClient({
        baseUrl: endpoint.url,
        headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
      })
      const location = { directory: process.cwd() }
      yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
      yield* Effect.promise(() => client.integration.connect.key({ integrationID: "kilo", key: "fixture-key" }))
      const session = yield* Effect.promise(() => client.session.create({ title: "Account sidebar fixture", location }))
      yield* Effect.forkScoped(
        runTui(input, endpoint, { args: { sessionID: session.id }, terminalHandoff }).pipe(
          Effect.ensuring(Effect.sync(closed.resolve)),
        ),
      )
      const privacy = client.rpc(PrivacyRpc.Definition)
      const openTeams = async () => {
        await setup.mockInput.typeText("/teams")
        setup.mockInput.pressEnter()
        await setup.waitForFrame(
          (frame) => frame.includes("Switch Kilo account") || frame.includes("Reveal Kilo account details?"),
          { maxPasses: 600 },
        )
        if (setup.captureCharFrame().includes("Reveal Kilo account details?")) {
          setup.mockInput.pressEnter()
          await setup.waitForFrame((frame) => frame.includes("Switch Kilo account"), { maxPasses: 600 })
        }
        await setup.waitForFrame((frame) => frame.includes("Personal account") && frame.includes("Fixture Org"), {
          maxPasses: 600,
        })
      }
      yield* Effect.tryPromise(async () => {
        await Promise.race([
          ready.promise,
          closed.promise.then(() => {
            throw new Error("TUI stopped before terminal handoff")
          }),
        ])
        await setup.waitForFrame(
          (frame) => frame.includes("Personal credits") && frame.includes("$0.00") && frame.includes("Kilo Pass"),
          { maxPasses: 600 },
        )
        await privacy.set({ enabled: true }, { location })
        await setup.waitForFrame(
          (frame) => frame.includes("Personal credits") && frame.includes("•••") && !frame.includes("Kilo Pass"),
          { maxPasses: 600 },
        )
        const frame = setup.captureCharFrame()
        assert(!frame.includes("Bonus"))
        assert(!frame.includes("Renews"))
        assert(personalBalanceCalls >= 1)

        // Funded personal account: the exact Pass rows must come from the loopback responses
        // (renewal date included), refreshed through the real /teams command on the same scope.
        await privacy.set({ enabled: false }, { location })
        // Barrier: the TUI privacy state must be off before /teams, or the command first
        // asks to reveal account details instead of opening the account dialog.
        await setup.waitForFrame(
          (frame) => frame.includes("Personal credits") && frame.includes("$0.00") && frame.includes("Kilo Pass"),
          { maxPasses: 600 },
        )
        personalBalance = 25.4
        personalPass = {
          subscription: {
            status: "active",
            currentPeriodBaseCreditsUsd: 50,
            currentPeriodUsageUsd: 12,
            currentPeriodBonusCreditsUsd: 5,
            nextBillingAt: "2026-11-15T00:00:00.000Z",
          },
        }
        await openTeams()
        setup.mockInput.pressEnter()
        await setup.waitForFrame(
          (frame) =>
            frame.includes("Personal credits") &&
            frame.includes("$25.40") &&
            frame.includes("$12.00 / $50.00") &&
            frame.includes("Bonus") &&
            frame.includes("+$5.00") &&
            frame.includes("Renews") &&
            frame.includes("Nov 15"),
          { maxPasses: 600 },
        )
        assert(personalBalanceCalls >= 2)

        // Privacy masks the funded amount and suppresses the entire Pass section.
        await privacy.set({ enabled: true }, { location })
        await setup.waitForFrame(
          (frame) =>
            frame.includes("•••") &&
            !frame.includes("$25.40") &&
            !frame.includes("Kilo Pass") &&
            !frame.includes("Bonus") &&
            !frame.includes("Renews"),
          { maxPasses: 600 },
        )

        // Team scope: the organization label and its own balance, with no personal Pass rows.
        await privacy.set({ enabled: false }, { location })
        await setup.waitForFrame((frame) => frame.includes("$25.40") && frame.includes("Kilo Pass"), { maxPasses: 600 })
        await openTeams()
        setup.mockInput.pressArrow("down")
        setup.mockInput.pressEnter()
        await setup.waitForFrame(
          (frame) =>
            frame.includes("Fixture Org team") &&
            frame.includes("$40.00") &&
            !frame.includes("Kilo Pass") &&
            !frame.includes("Bonus") &&
            !frame.includes("Renews"),
          { maxPasses: 600 },
        )
        assert(teamBalanceCalls >= 1)
      })
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
)

try {
  await task
  console.log("TUI_SIDEBAR_ACCOUNT_FIXTURE_OK")
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  await gateway.stop(true)
}
