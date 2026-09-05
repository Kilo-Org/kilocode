import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { runTui } from "../src/tui"

let calls = 0
let delayNext = false
let delayedMetadata = Promise.withResolvers<Response>()
let delayedRequested = Promise.withResolvers<void>()
const modelPaths: string[] = []
const catalog = {
  data: [
    { id: "recommended", name: "Fixture Recommended", context_length: 128000, preferredIndex: 0 },
    {
      id: "kilo-auto/free",
      name: "Fixture Auto",
      context_length: 128000,
      autoRouting: { models: ["recommended"] },
      hasUserByokAvailable: true,
      mayTrainOnYourPrompts: true,
    },
    { id: "plain", name: "Fixture Ordinary", context_length: 128000, supported_parameters: ["tools"] },
  ],
}
const teamCatalog = {
  data: [
    { id: "team-recommended", name: "Fixture Team Recommended", context_length: 128000, preferredIndex: 0 },
    {
      id: "kilo-auto/team",
      name: "Fixture Team Auto",
      context_length: 128000,
      autoRouting: { models: ["team-recommended"] },
    },
  ],
}
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/api/profile")
      return Response.json({
        organizations: [{ id: "team", name: "Fixture Team" }],
        selectedOrganizationId: null,
        hasPersonalAccount: true,
      })
    if (path === "/api/openrouter/models" || path === "/api/organizations/team/models") {
      assert.equal(request.headers.get("authorization"), "Bearer fixture-only")
      if (path === "/api/organizations/team/models")
        assert.equal(request.headers.get("x-kilocode-organizationid"), "team")
      calls++
      modelPaths.push(path)
      if (delayNext) {
        delayNext = false
        delayedRequested.resolve()
        return delayedMetadata.promise
      }
      return Response.json(path === "/api/openrouter/models" ? catalog : teamCatalog)
    }
    return new Response(null, { status: 404 })
  },
})
const setup = await createTestRenderer({ width: 120, height: 45, useThread: false, kittyKeyboard: true })
setup.renderer.start()
const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const input = layout("interactive")
        const endpoint = yield* launch(input, {
          models: false,
          recover: false,
          gateway: { server: gateway.url.origin },
          plugins: [
            define({
              id: "fixture.picker-inventory",
              effect: (ctx) =>
                ctx.catalog.transform((editor) => {
                  for (const provider of editor.provider.list()) {
                    for (const id of provider.models.keys()) {
                      if (provider.provider.id === "kilo" && ["kilo-auto/free", "recommended", "plain"].includes(id))
                        continue
                      if (provider.provider.id === "opencode" && id === "zen") continue
                      editor.model.remove(provider.provider.id, id)
                    }
                  }
                }),
            }),
          ],
          content: JSON.stringify({
            providers: {
              kilo: {
                name: "Kilo Gateway",
                package: "aisdk:@ai-sdk/openai-compatible",
                models: {
                  "kilo-auto/free": { name: "Fixture Auto" },
                  recommended: { name: "Fixture Recommended" },
                  plain: { name: "Fixture Ordinary" },
                },
              },
              opencode: {
                name: "OpenCode Zen",
                package: "aisdk:@ai-sdk/openai-compatible",
                models: { zen: { name: "Fixture Zen" } },
              },
            },
          }),
        })
        const client = createClient({
          baseUrl: endpoint.url,
          headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
        })
        const location = { directory: process.cwd() }
        yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
        yield* Effect.promise(() => client.integration.connect.key({ integrationID: "kilo", key: "fixture-only" }))
        yield* Effect.tryPromise(async () => {
          for (let attempt = 0; attempt < 100; attempt++) {
            const inventory = await client.model.list({ location })
            if (inventory.data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/free")) return
            await Bun.sleep(20)
          }
          throw new Error("Kilo catalog did not load")
        })
        delayNext = true
        const fiber = yield* Effect.forkScoped(
          runTui(input, endpoint, {
            terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
          }).pipe(Effect.ensuring(Effect.sync(closed.resolve))),
        )
        yield* Effect.tryPromise(async () => {
          await Promise.race([
            ready.promise,
            closed.promise.then(() => {
              throw new Error("TUI stopped before handoff")
            }),
          ])
          await setup.waitForFrame((frame) => frame.includes("Kilo internal preview") && frame.includes("Code ·"), {
            maxPasses: 600,
          })
          await setup.mockInput.typeText("/agents")
          await setup.waitForFrame((frame) => frame.includes("/agents"), { maxPasses: 600 })
          setup.mockInput.pressEnter()
          const agents = await setup.waitForFrame(
            (frame) => frame.includes("Select agent") && frame.includes("Debug"),
            { maxPasses: 600 },
          )
          for (const name of ["Code", "Ask", "Debug", "Plan"]) assert(agents.includes(name))
          assert(!agents.includes("Orchestrator"))
          setup.mockInput.pressEscape()
          await setup.waitForFrame((frame) => !frame.includes("Select agent"), { maxPasses: 600 })
          await setup.mockInput.typeText("/models")
          setup.mockInput.pressEnter()
          await Promise.race([
            delayedRequested.promise,
            closed.promise.then(() => {
              throw new Error("TUI stopped before model metadata was requested")
            }),
          ])
          const loading = await setup.waitForFrame((frame) => frame.includes("Loading Kilo model metadata"), {
            maxPasses: 600,
          })
          assert(!loading.includes("Fixture Auto"))
          assert(!loading.includes("Connect an integration"))
          delayedMetadata.resolve(Response.json(catalog))
          await setup.waitForFrame(
            (frame) => frame.includes("Kilo Auto") && frame.includes("Recommended") && frame.includes("Fixture Zen"),
            { maxPasses: 600 },
          )
          const frame = setup.captureCharFrame()
          assert(frame.indexOf("Kilo Auto") < frame.indexOf("Fixture Recommended"))
          assert(frame.indexOf("Fixture Ordinary") < frame.indexOf("Fixture Zen"))
          assert(!frame.includes("Favorites"))
          assert(frame.includes("BYOK"))
          assert(frame.includes("May train"))
          // Native action writes the native preference store; no Kilo preference clone.
          setup.mockInput.pressKey("f", { ctrl: true })
          await setup.waitForFrame(
            (frame) => frame.includes("Favorites") && frame.includes("BYOK") && frame.includes("May train"),
            { maxPasses: 600 },
          )
          await setup.mockInput.typeText("not-a-fixture-model")
          const noMatch = await setup.waitForFrame((frame) => frame.includes("No results found"), { maxPasses: 600 })
          assert(!noMatch.includes("Loading Kilo model metadata"))
          await setup.mockInput.pressEscape()
          await setup.waitForFrame((frame) => !frame.includes("Select model"), { maxPasses: 600 })
          await setup.mockInput.typeText("/models")
          setup.mockInput.pressEnter()
          await setup.waitForFrame((frame) => frame.includes("Favorites") && frame.includes("Fixture Auto"), {
            maxPasses: 600,
          })
          await setup.mockInput.pressEscape()
          await client.kilocode.organization.set({ organizationID: "team" })
          await Promise.race([
            (async () => {
              for (let attempt = 0; attempt < 100; attempt++) {
                const inventory = await client.model.list({ location })
                if (inventory.data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/team")) return
                await Bun.sleep(20)
              }
              throw new Error("Kilo team catalog did not load")
            })(),
            closed.promise.then(() => {
              throw new Error("TUI stopped before team catalog loaded")
            }),
          ])
          delayedMetadata = Promise.withResolvers<Response>()
          delayedRequested = Promise.withResolvers<void>()
          delayNext = true
          await setup.mockInput.typeText("/models")
          setup.mockInput.pressEnter()
          await Promise.race([
            delayedRequested.promise,
            closed.promise.then(() => {
              throw new Error("TUI stopped before team metadata was requested")
            }),
          ])
          const teamLoading = await setup.waitForFrame((frame) => frame.includes("Loading Kilo model metadata"), {
            maxPasses: 600,
          })
          assert(!teamLoading.includes("Fixture Team Auto"))
          delayedMetadata.resolve(Response.json(teamCatalog))
          const team = await setup.waitForFrame(
            (frame) => frame.includes("Kilo Auto") && frame.includes("Fixture Team Auto"),
            { maxPasses: 600 },
          )
          assert(!team.includes("Fixture Auto"))
          assert(!team.includes("BYOK"))
          assert(!team.includes("May train"))
          await setup.mockInput.pressEscape()
          assert.equal(calls, 7)
          assert.deepEqual(modelPaths, [
            "/api/openrouter/models",
            "/api/openrouter/models",
            "/api/openrouter/models",
            "/api/openrouter/models",
            "/api/organizations/team/models",
            "/api/organizations/team/models",
            "/api/organizations/team/models",
          ])
          assert.equal((await client.session.list({ directory: process.cwd() })).data.length, 0)
          await setup.mockInput.typeText("/exit")
          setup.mockInput.pressEnter()
          await closed.promise
        })
        yield* Fiber.join(fiber)
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
  console.log("MODEL_PICKER_UI_OK")
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  await gateway.stop(true)
}
