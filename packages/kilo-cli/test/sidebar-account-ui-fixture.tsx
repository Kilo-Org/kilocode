import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { PrivacyRpc } from "../src/privacy-rpc"
import { runTui } from "../src/tui"

let balanceCalls = 0
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/profile") {
      assert.equal(request.headers.get("authorization"), "Bearer fixture-key")
      return Response.json({ organizations: [], selectedOrganizationId: null, hasPersonalAccount: true })
    }
    if (url.pathname === "/api/profile/balance") {
      balanceCalls++
      assert.equal(request.headers.get("x-kilocode-organizationid"), null)
      return Response.json({ balance: 0 })
    }
    if (url.pathname === "/api/trpc/kiloPass.getState") {
      return Response.json([
        {
          result: {
            data: {
              json: {
                subscription: {
                  status: "active",
                  currentPeriodBaseCreditsUsd: 19,
                  currentPeriodUsageUsd: 3,
                  currentPeriodBonusCreditsUsd: 2,
                  nextBillingAt: "2026-10-01T00:00:00.000Z",
                },
              },
            },
          },
        },
      ])
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
      const input = layout("interactive")
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
        const privacy = client.rpc(PrivacyRpc.Definition)
        await privacy.set({ enabled: true }, { location })
        await setup.waitForFrame(
          (frame) => frame.includes("Personal credits") && frame.includes("•••") && !frame.includes("Kilo Pass"),
          { maxPasses: 600 },
        )
        const frame = setup.captureCharFrame()
        assert(!frame.includes("Bonus"))
        assert(!frame.includes("Renews"))
        assert(balanceCalls >= 1)
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
