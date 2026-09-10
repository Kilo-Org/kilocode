import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { guardedFixtureLayout } from "./fixture"
import { runTui } from "../src/tui"
import { fmtPrice, fmtCachedPrice, fmtContext } from "../src/tui-plugin/model-info-dialog"

// Unit assertions for pricing and context formatters (v1 cache.read > 0 or input === 0 rule)
assert.equal(fmtCachedPrice({ input: 0, cache: { read: 0 } }), "Free")
assert.equal(fmtCachedPrice({ input: 3, cache: { read: 0.3 } }), "$0.30/1M")
assert.equal(fmtCachedPrice({ input: 3, cache: { read: 0 } }), null)
assert.equal(fmtPrice(-1), "—")
assert.equal(fmtPrice(0), "Free")
assert.equal(fmtPrice(0.0025), "$0.0025/1M")
assert.equal(fmtPrice(15), "$15.00/1M")
assert.equal(fmtContext(500), "500")
assert.equal(fmtContext(1000), "1K")
assert.equal(fmtContext(128000), "128K")
assert.equal(fmtContext(1000000), "1M")

const scenario = process.env.TUI_MODEL_INFO_SCENARIO
assert(scenario === "valid" || scenario === "absent" || scenario === "empty" || scenario === "unavailable")

const setup = await createTestRenderer({ width: 160, height: 40, useThread: false, kittyKeyboard: true })
setup.renderer.start()

// The location is the outer fixture's cwd: cleanup is owned by the shared
// fixture(), so no extra temp directories are created here.
const location = { directory: process.cwd() }

// Loopback-only catalog fixture. The bench record mirrors the accepted wire shape:
// { overallScore, avgAttemptCostUsd } finite numbers.
const benchRecord = { overallScore: 0.425, avgAttemptCostUsd: 1.23 }
const catalog = {
  data: [
    ...(scenario === "absent"
      ? []
      : [
          {
            id: "kilo-auto/bench",
            name: "Info Fixture Auto",
            context_length: 128000,
            supported_parameters: ["tools", "reasoning"],
            description: "Bench auto model for testing description rendering.",
            opencode: { family: "kilo" },
            terminalBench: benchRecord,
            hasUserByokAvailable: true,
            mayTrainOnYourPrompts: true,
            pricing: {
              prompt: "0",
              completion: "0.000002",
              input_cache_read: "0",
            },
          },
        ]),
    { id: "kilo-auto/plain", name: "Plain Fixture Auto", context_length: 128000, supported_parameters: ["tools"] },
    { id: "ordinary", name: "Ordinary", context_length: 128000, supported_parameters: ["tools"] },
  ],
}
let failMetadata = false
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/api/profile")
      return Response.json({ organizations: [], selectedOrganizationId: null, hasPersonalAccount: true })
    if (path === "/api/openrouter/models") {
      if (failMetadata) {
        return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 503 })
      }
      if (request.headers.get("authorization") === null) return Response.json({ data: [] })
      assert.equal(request.headers.get("authorization"), "Bearer info-fixture")
      return Response.json(catalog)
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
              models: {
                ordinary: {
                  cost: [
                    {
                      input: 3,
                      output: 15,
                      cache: { read: 0.3 },
                    },
                    {
                      tier: { type: "context", size: 0 },
                      input: 4,
                      output: 20,
                      cache: { read: 0.4 },
                    },
                    {
                      tier: { type: "context", size: 128000 },
                      input: 6,
                      output: 30,
                      cache: { read: 0.6 },
                    },
                  ],
                },
              },
            },
          },
        }),
      })
      const client = createClient({
        baseUrl: endpoint.url,
        headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
      })
      yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
      if (scenario !== "empty") {
        yield* Effect.promise(() =>
          endpoint.importCredential({
            kind: "api-key",
            integrationID: "kilo",
            key: "info-fixture",
            label: "Model info fixture",
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
        if (scenario === "unavailable") {
          failMetadata = true
        }
      }

      // The session starts on the config model: the browse dialog inspects other
      // eligible models, so an accidental selection would be observable.
      const session = yield* Effect.promise(() =>
        client.session.create({
          title: "Model info fixture",
          location,
          model: { providerID: "kilo", id: "kilo/ordinary" },
        }),
      )
      const fiber = yield* Effect.forkScoped(
        runTui(input, endpoint, {
          args: { sessionID: session.id },
          terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve }),
        }).pipe(Effect.ensuring(Effect.sync(closed.resolve))),
      )
      yield* Effect.tryPromise(async () => {
        await Promise.race([
          ready.promise,
          closed.promise.then(() => {
            throw new Error("TUI closed before terminal handoff")
          }),
        ])
        await setup.waitForFrame((frame) => frame.includes("Model info fixture"), { maxPasses: 600 })

        await setup.mockInput.typeText("/model-info")
        await Bun.sleep(300)
        setup.mockInput.pressEnter()
        if (scenario === "empty") {
          await setup.waitForFrame((frame) => frame.includes("No models available for this location."), {
            maxPasses: 600,
          })
          assert.equal((await client.model.list({ location })).data.length, 0)
          assert.equal((await client.session.inbox.list({ sessionID: session.id })).length, 0)
          assert.equal((await client.message.list({ sessionID: session.id })).data.length, 0)
          await setup.mockInput.typeText("/exit")
          setup.mockInput.pressEnter()
          await closed.promise
          return
        }
        await setup.waitForFrame((frame) => frame.includes("Kilo model info") && frame.includes("Plain Fixture Auto"), {
          maxPasses: 600,
        })
        await Bun.sleep(400)

        // Browse-only: inspect the target model. The catalog order is known, so the
        // highlight moves with the dialog's own arrow bindings (proven pressArrow
        // navigation) instead of racing the filter input.
        const ups = scenario === "valid" ? 2 : 1
        for (let index = 0; index < ups; index++) setup.mockInput.pressArrow("up")
        await Bun.sleep(200)
        setup.mockInput.pressEnter()

        await setup.waitForFrame((frame) => frame.includes("Browse only"), { maxPasses: 600 })
        assert(
          setup.captureCharFrame().includes(scenario === "valid" ? "Info Fixture Auto" : "Plain Fixture Auto"),
          "the panel must inspect the requested model, not the session's current model",
        )
        if (scenario === "valid") {
          await setup.waitForFrame(
            (frame) => frame.includes("Terminal Bench 2.0") && frame.includes("42.5%") && frame.includes("$1.23"),
            { maxPasses: 600 },
          )
        }
        assert(setup.captureCharFrame().includes("Max output"), "output limit is visible")
        assert(setup.captureCharFrame().includes("Tool calling"), "tool support is visible")
        if (scenario === "valid") {
          assert(setup.captureCharFrame().includes("BYOK"), "real BYOK metadata is disclosed")
          assert(setup.captureCharFrame().includes("may train on your prompts"), "real training metadata is disclosed")
          assert(setup.captureCharFrame().includes("Description"), "description label is visible")
          assert(
            setup.captureCharFrame().includes("Bench auto model for testing description rendering."),
            "description content is rendered",
          )
          assert(/Reasoning\s+Yes/.test(setup.captureCharFrame()), "reasoning capability is rendered as Yes")
          assert(setup.captureCharFrame().includes("Family"), "family label is visible")
          assert(setup.captureCharFrame().includes("Kilo"), "family name is rendered")
          assert(setup.captureCharFrame().includes("Input"), "input cost is rendered")
          assert(setup.captureCharFrame().includes("Output"), "output cost is rendered")
          assert(setup.captureCharFrame().includes("Cached"), "cached cost is rendered")
          assert(setup.captureCharFrame().includes("Free"), "free pricing is rendered per v1 rule")
        }
        if (scenario === "absent") {
          assert(!setup.captureCharFrame().includes("may train on your prompts"), "missing metadata is not invented")
          assert(!setup.captureCharFrame().includes("Description"), "missing description is not rendered")
          assert(!/Reasoning\s+Yes/.test(setup.captureCharFrame()), "missing reasoning is not rendered as Yes")
          assert(!setup.captureCharFrame().includes("Family"), "missing family is not rendered")
          await Bun.sleep(600)
          assert(!setup.captureCharFrame().includes("Terminal Bench 2.0"), "no bench section without Entry metadata")
          assert(
            setup.captureCharFrame().includes("Pricing unavailable"),
            "pricing without quotes is explicitly unavailable",
          )
        }
        if (scenario === "unavailable") {
          assert(
            setup.captureCharFrame().includes("Kilo model metadata unavailable for this account scope"),
            "unavailable metadata warning is rendered on RPC failure",
          )
          assert(!setup.captureCharFrame().includes("Terminal Bench 2.0"), "no bench section on metadata RPC failure")
        }

        // The panel stays open across a resize: native dialogs resize rather than
        // hide, so usable content must persist at both widths.
        setup.resize(120, 40)
        await Bun.sleep(400)
        assert(setup.captureCharFrame().includes("Browse only"), "the panel stays open at narrow width")
        setup.resize(160, 40)
        await Bun.sleep(400)
        if (scenario === "valid") {
          assert(setup.captureCharFrame().includes("42.5%"), "the bench values survive a resize")
        }

        // Panel stays open while nothing changes (no spurious scope clear).
        await Bun.sleep(600)
        assert(setup.captureCharFrame().includes("Browse only"), "the panel stays open without scope changes")

        // A credential touch publishes credential.updated, which the production
        // account watcher treats as a revision bump: the deferred scope guard must
        // close the panel instead of retaining a stale deferred dialog.
        await endpoint.importCredential({
          kind: "api-key",
          integrationID: "kilo",
          key: "info-fixture",
          label: "Model info fixture (touch)",
          metadata: { server: gateway.url.origin, hasPersonalAccount: "true" },
        })
        await setup.waitForFrame((frame) => !frame.includes("Browse only"), { maxPasses: 600 })
        assert(!setup.captureCharFrame().includes("42.5%"), "no stale deferred dialog after a revision bump")

        if (scenario === "valid") {
          // Re-open /model-info and inspect ordinary (which has real native context tier quotes configured)
          await setup.mockInput.typeText("/model-info")
          await Bun.sleep(300)
          setup.mockInput.pressEnter()
          await setup.waitForFrame(
            (frame) => frame.includes("Kilo model info") && frame.includes("Plain Fixture Auto"),
            { maxPasses: 600 },
          )
          await Bun.sleep(200)
          // Filter to ordinary and select it
          await setup.mockInput.typeText("ordinary")
          await Bun.sleep(200)
          setup.mockInput.pressEnter()
          await setup.waitForFrame((frame) => frame.includes("Browse only") && frame.includes("Context > 128K:"), {
            maxPasses: 600,
          })

          // Verify exact base rates from native Model.Info
          assert(setup.captureCharFrame().includes("Input") && setup.captureCharFrame().includes("$3.00/1M"))
          assert(setup.captureCharFrame().includes("Output") && setup.captureCharFrame().includes("$15.00/1M"))
          assert(setup.captureCharFrame().includes("Cached") && setup.captureCharFrame().includes("$0.30/1M"))

          // Verify exact context-tier threshold and rates (including zero-threshold tier)
          assert(setup.captureCharFrame().includes("Context > 0:"))
          assert(setup.captureCharFrame().includes("$4.00/1M"))
          assert(setup.captureCharFrame().includes("$20.00/1M"))
          assert(setup.captureCharFrame().includes("$0.40/1M"))

          assert(setup.captureCharFrame().includes("Context > 128K:"))
          assert(setup.captureCharFrame().includes("$6.00/1M"))
          assert(setup.captureCharFrame().includes("$30.00/1M"))
          assert(setup.captureCharFrame().includes("$0.60/1M"))

          // Verify bounded scrolling at short terminal height: footer remains visible
          setup.resize(120, 20)
          await Bun.sleep(400)
          assert(setup.captureCharFrame().includes("Browse only"), "footer remains visible at short terminal height")
          setup.resize(160, 40)
          await Bun.sleep(400)
        }

        // Browse-only regressions against the public session state: the model
        // record, the durable model-switched messages, and the pending inbox are
        // untouched by inspecting a different model.
        const after = await client.session.get({ sessionID: session.id })
        assert.equal(after.model?.id, "kilo/ordinary", "browse-only inspection must not change the session model")
        const switched = (await client.message.list({ sessionID: session.id })).data.filter(
          (message) => message.type === "model-switched",
        )
        assert.equal(switched.length, 0, "no model-switched message may be appended by browsing")
        const inbox = await client.session.inbox.list({ sessionID: session.id })
        assert.equal(inbox.length, 0, "no pending inbox rows may be enqueued by browsing")

        await setup.mockInput.pressKey("ESCAPE")
        await Bun.sleep(200)
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
  console.log(`TUI_MODEL_INFO_${scenario.toUpperCase()}_OK`)
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  await gateway.stop(true)
}
